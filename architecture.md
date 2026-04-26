# custom_ui — Architecture

A demo of a **server-driven UI** pattern. The user types a sentence, the backend decides which UI blocks to emit, and the frontend renders those blocks through a component registry. Scenario 1 is literal **gate control** — open/close/lock gates, request access for gates the user lacks permission on, list who can access what, approve/deny pending requests.

The showpiece is the **request sheet**: when a user without permission asks to open a gate, the backend asks the LLM which form fields it can pre-fill from the user's profile, then ships a `RequestForm` block with that decision. The sheet pops up, the LLM-known fields visually dematerialize into peach particles, and the user only fills the gaps the model couldn't infer (visitor + intention + time).

---

## 1. System overview

```
┌──────────┐  POST /api/chat (SSE)   ┌──────────────────────┐  POST /render    ┌─────────────┐
│ Browser  │ ──────────────────────▶ │  FastAPI backend     │ ──────────────▶ │  Qwen3-14B  │
│  (SPA)   │ ◀── event: block ────── │  (custom-ui-api)     │ ◀── component ── │  (5070Ti)   │
└──────────┘                         │                      │                  └─────────────┘
                                     │  parser → executor   │
                                     │  + llm adapter       │                  ┌─────────────┐
                                     │  + autofill picker   │                  │ Postgres 16 │
                                     └──────────┬───────────┘                  │ (custom-ui- │
                                                └─────────────────────────────▶│     db)     │
                                                          SQLAlchemy           └─────────────┘
```

Two independent machines:

| Machine | What | Network |
|--|--|--|
| **secretseasoning.top VPS** (Tencent Cloud, Ubuntu 22.04) | Nginx + `custom-ui-api` container + `custom-ui-db` container | Public on 443/80 |
| **5070Ti box** (Docker, RTX 5070 Ti) | `qwen-eval` container hosting Qwen3-14B-AWQ | Reaches VPS via SSH reverse tunnel only |

---

## 2. Block protocol (frontend ↔ backend contract)

Backend streams JSON blocks over SSE from `POST /api/chat`. Each `event: block` carries one block; `event: done` terminates.

```ts
type Block =
  | { type: 'AssistantMessage'; props: { text: string } }
  | { type: 'GateCard';         props: { id, label, status, animate? } }
  | { type: 'GateGrid';         props: { gates: GateCardProps[] } }
  | { type: 'AccessList';       props: { gateId, gateLabel, users[] } }
  | { type: 'RequestCard';      props: { id, gateId, gateLabel, requester, reason?, status, decidedBy?, decidedAt?, createdAt? } }
  | { type: 'RequestList';      props: { scope: 'mine'|'all-pending', requests: RequestCardProps[] } }
  | { type: 'RequestForm';      props: { gateId, gateLabel, profile?: Record<string,string>, autoFill?: string[] } }
  | { type: 'Toast';            props: { variant: 'success'|'denied'|'error', text } }
  | { type: 'Alert';            props: { message, severity?: 'info'|'warning'|'error' } }
```

Frontend has a **registry** (`frontend/src/blocks/registry.tsx`) mapping `type` strings to React components. `BlockRenderer` iterates and renders each; unknown types fall back to raw JSON. All string props run through a defense-in-depth `sanitizeProps` filter that drops values matching a payload-shaped regex (`<script`, `javascript:`, `data:text/html`, `on<evt>=`, `<iframe`, `document.cookie`, `eval(`).

A `handlerAllowlist: Record<string, fn>` is exported for future interactive blocks. Scenario 1 is empty there; LLM-supplied handler identifiers get dropped silently once populated.

---

## 3. Backend request pipeline

```
 user message
     │
     ▼
┌───────────────────────┐  regex patterns,
│ parser.py             │  15 intent kinds (open/close/lock/grant/revoke/
│ parse(msg) → Intent   │   request_access/list_requests/approve/...)
└──────────┬────────────┘
           │ Intent{kind, gate_id, target_username, request_id, reason, raw}
           ▼
┌───────────────────────┐  role + permission checks
│ executor.py           │  DB mutations committed here
│ execute(session, user,│  access_log row appended
│         intent, llm)  │
└──────────┬────────────┘
           │ yields block dicts:
           │   1) AssistantMessage (LLM-embellished OR canned)  ─┐  via _yield_primary
           │   2) primary visual  (GateCard/Grid/AccessList/    ─┤  on the success path
           │                       RequestCard/RequestList)     ─┘
           │   denial paths skip the LLM and yield directly:
           │     denied GateCard + RequestForm + Toast
           │   3) Toast            (success/denied/error — always deterministic)
           ▼
┌───────────────────────┐
│ routers/chat.py       │  wraps each block in event:block,
│ SSE stream            │  terminates with event:done
└───────────────────────┘
```

**All action logic is deterministic.** Auth, DB writes, access logs, and the choice of primary visual come from the executor and the DB — never the LLM. The LLM only narrates and picks autofill subsets.

### Denial → request-sheet flow

When a non-admin tries to `open` / `close` a gate they're not permitted on (or a `locked` admin-controlled gate), the executor:

1. Yields a denied `GateCard` (animation: shake).
2. Calls `_request_form_for_user(gate, user, llm)` which:
   - Looks up `MOCK_PROFILES[user.username]` (mock identity blob).
   - Asks the LLM which subset of profile fields it can pre-fill (see §4.2).
   - Returns a `RequestForm` block carrying `{gateId, gateLabel, profile, autoFill}`.
3. Yields that block + a denied `Toast`.

No `GateRequest` row is created at this stage. The row is created later when the user submits the sheet — which dispatches a `request gate N because <packed reason>` chat command back through the same pipeline, hitting `IntentKind.request_access`.

---

## 4. Hybrid LLM layer

The LLM (Qwen3-14B-AWQ, 4-bit, ~10 GB VRAM) runs in a Docker container on the 5070Ti, exposing `POST /render {intent, registry} → {valid, mode, component, props, text, warnings, errors, retries_used, latency_ms, model_version}`. The wrapper has dual-mode output: **chat** (`component=null`, `text="..."`) for prose, **action** (`component=X`, `props={...}`) when the intent matches a registry entry.

Backend has two distinct uses for the LLM:

### 4.1 Primary block narration — `app/llm/adapter.py`

Inside `_yield_primary`, the executor calls `render_block(client, context, snapshot)` once per turn:
- `context` describes what just happened (e.g. `"Opened gate 7 (Security Checkpoint)."`).
- `snapshot` is a dict of DB-truth props for the data-bearing component the executor already chose.
- Adapter keys on `component`:
  - text-bearing (`AssistantMessage`/`Alert`) → sanitize and use the model's `text`.
  - data-bearing (`GateCard`/`GateGrid`/`AccessList`/`RequestCard`/`RequestList`/`RequestForm`) → ignore model's props, substitute the snapshot.
  - else → fall back to `_prose_from_any` (looks for `text` / `message` / `raw` / `content` / `output`); wrap as `AssistantMessage`.
- Returns a single block dict, or `None` on any failure → caller emits the deterministic AssistantMessage + visual fallback.

Failure modes (transparent to the user): httpx timeout/connect → `client.render` returns `None` → adapter returns `None` → canned text. Warning codes `dangerous_substring` and `system_prompt_echo` also force a drop. `string_too_long` truncates to 400 chars + ellipsis.

### 4.2 Request-form autofill picker — `app/llm/profile.py`

For the request-sheet showpiece. `pick_autofill_fields(client, username, profile, field_keys, request_context)`:

- Builds a chat-prose intent embedding the username, profile blob, request context, and field key list.
- Asks the wrapper to reply via `AssistantMessage` whose `text` is **only** a JSON array, e.g. `["name","employeeId"]`.
- Sends the **full** registry so the wrapper has somewhere to land — sending `{components: []}` triggers a wrapper refusal ("requested action cannot be performed with the available components").
- Parses: regex finds the first `[...]`, JSON-decodes, intersects with `field_keys`. Falls back to keyword match across the full prose if JSON parse fails. On any error / empty parse, returns `[]`.
- Round-trip ~2 s. On `[]` the frontend simply renders a fillable sheet with no auto-erase — graceful degradation.

`MOCK_PROFILES` (`app/profiles.py`) is the canonical source of profile data — five demo personas with `{name, employeeId, department, contact}`. `dateTime` is filled client-side (`now`); `visitor` and `intention` are user judgment, never auto-fillable.

### Feature flag

`LLM_RENDER_URL` in `/home/ubuntu/custom-ui/.env` — set → both layers active; unset/empty → adapter is `None`, `_yield_primary` always uses canned text, `_request_form_for_user` returns the bare form (no `profile`/`autoFill`), frontend shows an empty sheet for the user to fill manually.

---

## 5. Data model

```
users              gates                gate_permissions            access_log               gate_requests
-----              -----                ----------------            ----------               -------------
id                 id                   id                          id                       id
username UNIQUE    label                user_id → users.id          gate_id (nullable)       requester_id → users.id
password_hash      status (enum)        gate_id → gates.id          user_id (nullable)       gate_id → gates.id
role (enum)        created_at           granted_by → users.id       action (enum)            reason (text, nullable)
created_at                              granted_at                  result (enum)            status (enum)
                                        UNIQUE(user_id, gate_id)    message                  decided_by → users.id (nullable)
                                                                    created_at               decided_at (nullable)
                                                                                             created_at
```

- `role`: `guest` | `user` | `admin`
- `status` (gate): `open` | `closed` | `locked` (locked = admin-only)
- `status` (request): `pending` | `approved` | `denied` | `cancelled`
- `action`: `open` | `close` | `lock` | `unlock` | `grant` | `revoke` | `query`
- `result`: `success` | `denied` | `error`

Enums are declared `SAEnum(..., native_enum=False, length=16)` to avoid Postgres enum migration pain.

**Seed (`app/seed.py`):** 10 gates (Main Entrance … Reception, three of which seed `locked`). Demo users:
- `admin`/`admin123` and `nova`/`nova123` — admins (full control, bypass perms).
- `IReallyRock`/`rockrock` — user, perms on gates 5–9.
- `morgan`, `priya`, `dex`, `sam` — users with overlapping perms across operations / R&D / facilities.
- `guest`/`guest`, `visitor01`/`visitor` — read-only.

**`MOCK_PROFILES`** (`app/profiles.py`) maps the five user-role personas to `{name, employeeId, department, contact}`. Lives outside the DB schema since it's purely demo identity flavor for the autofill picker.

---

## 6. Frontend

```
frontend/
├── src/
│   ├── api/
│   │   ├── client.ts       # fetch wrapper with bearer token
│   │   └── chat.ts         # SSE consumer; normalizes CRLF→LF (sse-starlette quirk)
│   ├── stores/
│   │   ├── authStore.ts    # zustand + persist (key: custom_ui.auth)
│   │   ├── gatesStore.ts   # optimistic + server-confirmed gate state
│   │   └── chatStore.ts    # message/block log
│   ├── blocks/
│   │   ├── registry.tsx    # Block union, registry, handlerAllowlist, sanitizer, BlockRenderer
│   │   ├── AssistantMessage.tsx
│   │   ├── GateCard.tsx    # outlined card + offset color tag, status circle, lock-icon slide-in
│   │   ├── GateGrid.tsx
│   │   ├── AccessList.tsx
│   │   ├── RequestCard.tsx
│   │   ├── RequestList.tsx
│   │   ├── RequestSheet.tsx # the showpiece — pinned modal, LLM-driven autofill, dematerialize animation
│   │   ├── RequestForm.tsx  # legacy inline variant; not in registry today
│   │   ├── Toast.tsx
│   │   └── Alert.tsx
│   ├── components/
│   │   ├── ChatInput.tsx
│   │   ├── MessageList.tsx
│   │   ├── Sidebar.tsx     # left rail: persona badge, sign out
│   │   └── GatePanel.tsx   # right rail: vertical list of gate rows
│   ├── views/
│   │   ├── Login.tsx
│   │   └── Home.tsx        # h-screen + overflow-hidden viewport lock; pinned chat input + RequestSheet
│   └── index.css           # Fraunces serif headline, .surface utility, skin tokens
└── verify/                 # Playwright scripts (chat-e2e, gate-gallery, sheet-erase-timing, gates-panel-list)
```

### Skin palette (`tailwind.config.js`, `skin.*` namespace)

Light / cream — replaces an earlier dark-amber theme:

| Token | Hex | Use |
|--|--|--|
| `skin-bg` | `#F5EFE6` | canvas |
| `skin-surface` | `#ECE0CE` | cards / sheet |
| `skin-surface-2` | `#E0CFB8` | active / hovered row lift |
| `skin-border` | `#D8C7B0` | sand dividers |
| `skin-ink` | `#4A3728` | primary text |
| `skin-muted` | `#8A7A66` | hints, placeholders |
| `skin-accent` | `#D89B7A` | peach — focus, particles, CTA |
| `skin-accent-deep` | `#B97A58` | pressed |
| `skin-success` | `#8B9D5A` | warm olive (gate open, request approved) |
| `skin-danger` | `#C9543E` | terracotta (locked, denied, errors) |

Body type stays Inter; modal headline uses Fraunces (Google Fonts `@import` in `index.css`, falls back to Georgia under CSP).

### Layout

`Home.tsx` is `h-screen flex overflow-hidden`. Left aside (Sidebar, persona + sign out) is fixed-width. Center column (`<main relative>`) holds chat header + scrollable `MessageList` + pinned `ChatInput`. Right aside (gates · live) holds the vertical `GatePanel`. The `RequestSheet` modal is anchored `absolute z-30 left-4 right-4 bottom-[96px]` to `<main>`, so it floats above the chat thread but stays glued to the input — chat scrolls behind it.

### Showpiece animation: `RequestSheet.tsx`

State machine: `'fill' → 'erasing' → 'confirm' → 'closing' → 'gone'`.

Mount:
1. Initial values: spread `profile[key]` into state for every `key ∈ autoFill`. Empty string for the rest. `dateTime` defaults to "now".
2. Cursor lands on the first field whose key is **not** in `autoFill` and whose value is empty (typically `visitor`).
3. After `STARTUP_DELAY_MS` (500 ms) — so the user registers the prefilled lines — every row whose key is in `autoFill` enters `erasing` simultaneously.
4. Each char in those rows spawns 3 small peach blocks (5 px squares, `bg-skin-accent`) that scatter radially with random angle + 28–88 px distance + random rotation, fade over 600 ms. The original glyph fades out in 180 ms. Row collapses height/padding 480 ms in.
5. The user types the remaining rows. Submit re-runs the erase on rows still visible.
6. Submit dispatches `cu:chat-send` with `request gate N because <formatted reason>` — Home.tsx forwards it to the chat pipeline with `silent: true` so no fake user bubble appears.

There is no convergence target — earlier "fly to a point" idiom was replaced by radial scatter ("dematerialize") to read more like "the LLM absorbed it" rather than "the chars are sucked into a corner."

`useReducedMotion` collapses the prefilled rows instantly without particle scatter; submit-time erase becomes a fast height-collapse only.

### `GateCard.tsx` (right rail)

Vertical list of outlined cream rectangles, each with an offset peach/olive/terracotta "tag" backing peeking from below-right. Status circle (olive `Check` for open, terracotta `Minus` for closed/locked). Locked rows get an extra small `Lock` icon at the right edge that slides in from `x:14, scale:0.6` on transition. Tag and circle backgrounds are driven via Framer's `animate={{ backgroundColor: ... }}` — Tailwind class swaps would snap, motion's `backgroundColor` tweens.

---

## 7. Deployment (secretseasoning.top)

```
/home/ubuntu/custom-ui/
├── backend/
│   ├── app/                 # FastAPI, SQLAlchemy async, JWT, SSE, httpx
│   ├── Dockerfile           # python:3.13-slim, PIP_INDEX_URL=pypi.tuna.tsinghua.edu.cn
│   └── pyproject.toml
├── frontend/dist/           # Vite build, served directly by Nginx
├── nginx/custom-ui.conf
├── docker-compose.prod.yml  # db + api services
└── .env (mode 600)          # JWT_SECRET, DB_PASSWORD, LLM_RENDER_URL
```

| Process | Where | Bound | Restart |
|--|--|--|--|
| `custom-ui-db` (postgres:16-alpine) | Docker, compose net 172.19.0.0/16 | internal | `unless-stopped` |
| `custom-ui-api` (uvicorn) | Docker, compose net 172.19.0.0/16 | `127.0.0.1:8000` on host | `unless-stopped` |
| Nginx 1.18 | host | `:80` redirect + `:443` TLS | systemd |

### Nginx vhost (`nginx/custom-ui.conf`, also installed at `/etc/nginx/sites-available/custom-ui.conf`)

- `location /assets/` — `expires 1y; Cache-Control: public, immutable` for hashed bundles.
- **`location /` (SPA fallback)** — `Cache-Control: no-cache, no-store, must-revalidate; Pragma: no-cache`. Without this, deploying a fresh `dist/index.html` doesn't invalidate the user's cached HTML, so they keep loading the old (still-on-disk) hashed bundle. Repeating the four security headers inside the location is required because nginx drops parent `add_header` directives wherever a child `add_header` is declared.
- `location = /api/chat` — `proxy_buffering off`, 300 s read/send timeouts, for SSE streaming.
- `location = /api/render` and `location = /api/healthz` — proxy to `172.19.0.1:8001` (the LLM tunnel endpoint).
- `location /api/` — proxy to `127.0.0.1:8000`.

### Security headers

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
                         img-src 'self' data: https:; connect-src 'self'; object-src 'none';
                         base-uri 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
```

`unsafe-inline` on `style-src` is required because Framer Motion writes inline `style` attributes for animated values. The Fraunces `@import` in `index.css` is currently blocked by CSP (`fonts.googleapis.com` not allowlisted) — the headline silently falls back to Georgia. Allowlisting Google Fonts is a one-line widening if the serif matters more than the strict CSP.

### Deploy flow

| Surface | Steps |
|--|--|
| Frontend | `cd frontend && npm run build` → scp `dist/assets/*` then `dist/index.html` → `curl -sk https://127.0.0.1:18443/ -H 'Host: secretseasoning.top'` to confirm the served HTML references the new hashed JS. |
| Backend | scp `backend/app/**` → `ssh ubuntu-server "cd /home/ubuntu/custom-ui && sudo docker compose -f docker-compose.prod.yml build api && up -d api"`. **`docker compose restart` reuses the existing image and will not pick up disk changes** — `build` then `up -d` is required. |

---

## 8. LLM tunnel topology

```
┌────────────────────────┐  ssh -R 172.19.0.1:8001:localhost:8001        ┌────────────────────────┐
│  5070Ti (local)        │ ────────────────────────────────────────────▶ │  VPS (secretseasoning) │
│                        │                                                │                        │
│  qwen-eval container   │                                                │  tunnel endpoint bound │
│  uvicorn on :8001      │                                                │  on 172.19.0.1:8001    │
│  /render, /healthz     │                                                │                        │
└────────────────────────┘                                                │  ┌─────────────────┐   │
                                                                          │  │ custom-ui-api   │   │
                                                                          │  │ (compose net    │   │
                                                                          │  │  172.19.0.0/16) │   │
                                                                          │  │ httpx →         │   │
                                                                          │  │ 172.19.0.1:8001 │   │
                                                                          │  └─────────────────┘   │
                                                                          └────────────────────────┘
```

**Gotchas:**

- Tunnel must bind to `172.19.0.1` (compose bridge gateway), **not** `127.0.0.1` — the api container can't reach loopback.
- VPS `sshd_config` requires `GatewayPorts clientspecified`; UFW needs `ALLOW 172.19.0.0/16 → 8001/tcp`.
- Inside the container, `host.docker.internal` resolves to `172.17.0.1` (the default `docker0` bridge), **not** `172.19.0.1`. So `LLM_RENDER_URL=http://172.19.0.1:8001/render` uses the IP literal.
- Tunnel down → clear `LLM_RENDER_URL` in `.env` or every chat turn pays a ~3 s connect timeout before falling back.

---

## 9. Safety model

Four layers at the LLM boundary, in the order they run:

1. **Input length cap** — `POST /api/chat` validates `message: Field(max_length=500)`. The wrapper further truncates intent > 1000 chars.
2. **Hardened system prompt** — qwen-eval ships a prompt that refuses role-swap, prompt-leak, and meta-commentary, emitting a neutral `Alert` on subversion.
3. **Validator** (qwen-eval) — JSON shape, top-level keys, component in registry, type/enum/required-prop/duplicate-key checks.
4. **Value sanitizer** (qwen-eval) — emits warning codes for payload-shaped strings.

**Frontend defenses:**

- `sanitizeProps` regex-filters every string prop at render time.
- No `eval()`, `new Function()`, `dangerouslySetInnerHTML` anywhere in `frontend/src`.
- Handler props resolve through `handlerAllowlist` (empty today); unknown names dropped.
- React's default text escaping covers interpolated content.

**Backend defenses:**

- Adapter drops LLM output on `dangerous_substring` and `system_prompt_echo` warnings; truncates on `string_too_long`.
- Data-bearing props are never LLM-sourced — they come from DB rows inside the executor.
- The autofill picker intersects the LLM's chosen field keys against the server-side allowlist (`PROFILE_FIELDS`) before trusting them, so the model can only narrow the set, never expand it.
- Actions (DB mutations, authz, access log) never touch the LLM.

**Network defenses:**

- Backend bound to `127.0.0.1:8000` only; public traffic traverses Nginx.
- LLM tunnel SSH-authenticated (ed25519), private docker subnet, gated by UFW.

---

## 10. Verification

Backend: `pytest` from `backend/` — 46 tests covering parser, executor (gate ops + request flows), adapter, and routers.

Frontend: Playwright scripts in `frontend/verify/`:
- `chat-e2e.mjs` — login + multi-turn chat smoke.
- `gate-gallery.mjs` — gate-card animation states, denial shake displacement sampling.
- `gates-panel-list.mjs` — right-rail vertical list, lock-icon presence, status-circle background tween via MutationObserver.
- `sheet-erase-timing.mjs` — request sheet popup auto-erase + submit-erase, capturing per-row erase timestamps and recording video to `verify/out/`.

Scripts target the prod tunnel by default (`https://127.0.0.1:18443/`) — local dev environment lacks the LLM tunnel and chat-mode prose responses fall back to canned text there.

---

## 11. Out of scope

- Full pure-LLM renderer — actions stay deterministic.
- Constrained JSON decoding in the LLM — retry-with-feedback is sufficient for this registry.
- Multi-turn conversation memory — the LLM is stateless by contract.
- Real identity provider for profile data — `MOCK_PROFILES` is the demo's canonical source.
- ICP filing — Chinese regulatory step that would make the VPS reliably reachable from mainland networks; separate infra task.
- Rate limiting, MFA, OAuth — demo doesn't need them.
