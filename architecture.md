# custom_ui — Architecture

A demo of a **server-driven UI** pattern. The user types a sentence, the backend decides which UI blocks to emit, and the frontend renders those blocks through a component registry. Scenario 1 is literal **gate control** (open/close/lock gates, grant access, list who can access what).

---

## 1. System overview

```
┌──────────┐   POST /api/chat (SSE)   ┌──────────────────────┐   POST /render    ┌─────────────┐
│ Browser  │ ───────────────────────▶ │  FastAPI backend     │ ───────────────▶ │  Qwen3-14B  │
│  (SPA)   │ ◀─── event: block  ────  │  (custom-ui-api)     │ ◀── component  ── │  (5070Ti)   │
└──────────┘                          │                      │                   └─────────────┘
                                      │  parser → executor   │
                                      │  + llm adapter       │                   ┌─────────────┐
                                      └──────────┬───────────┘                   │ Postgres 16 │
                                                 └──────────────────────────────▶│ (custom-ui- │
                                                           SQLAlchemy            │     db)     │
                                                                                 └─────────────┘
```

Two independent machines:

| Machine | What | Network |
|--|--|--|
| **secretseasoning.top VPS** (Tencent Cloud, Ubuntu 22.04) | Nginx + `custom-ui-api` container + `custom-ui-db` container | Public at 443/80 |
| **5070Ti local box** (Docker Desktop, RTX 5070 Ti) | `qwen-eval:nv25.02` container hosting the Qwen3-14B LLM | Private — connected to VPS via SSH reverse tunnel |

---

## 2. Block protocol (frontend ↔ backend contract)

Backend streams a sequence of JSON blocks over SSE from `POST /api/chat`. Each `event: block` carries one block; `event: done` terminates.

```ts
type Block =
  | { type: 'AssistantMessage'; props: { text: string } }
  | { type: 'GateCard';         props: { id, label, status, animate? } }
  | { type: 'GateGrid';         props: { gates: GateCardProps[] } }
  | { type: 'AccessList';       props: { gateId, gateLabel, users[] } }
  | { type: 'Toast';            props: { variant: 'success'|'denied'|'error', text } }
  | { type: 'Alert';            props: { message, severity?: 'info'|'warning'|'error' } }
```

Frontend has a **registry** (`frontend/src/blocks/registry.tsx`) mapping the `type` string to a React component. `BlockRenderer` iterates and renders each; unknown types fall back to raw JSON. All string props run through a defense-in-depth `sanitizeProps` filter that drops values matching a payload-shaped regex (`<script`, `javascript:`, `data:text/html`, `on<evt>=`, `<iframe`, `document.cookie`, `eval(`).

A `handlerAllowlist: Record<string, fn>` is exported for future interactive blocks. Scenario 1 has no interactive handlers, so the allowlist is empty; LLM-supplied handler identifiers get dropped silently once populated.

---

## 3. Backend request pipeline

```
 user message
     │
     ▼
┌───────────────────────┐  regex patterns,
│ parser.py             │  9 intent kinds
│ parse(msg) → Intent   │  (LLM swap-in point)
└──────────┬────────────┘
           │ Intent{kind, gate_id, target_username, raw}
           ▼
┌───────────────────────┐  role + permission checks
│ executor.py           │  mirror of gates.py REST logic
│ execute(session, user,│  DB mutations committed here
│         intent, llm)  │  access_log row appended
└──────────┬────────────┘
           │ yields block dicts:
           │   1) AssistantMessage (text: LLM-embellished OR canned)
           │   2) primary visual  (GateCard / GateGrid / AccessList)
           │   3) Toast           (success/denied/error — deterministic)
           ▼
┌───────────────────────┐
│ routers/chat.py       │  wraps each block in event:block,
│ SSE stream            │  terminates with event:done
└───────────────────────┘
```

**All action logic is deterministic.** Auth, DB writes, access logs, and the choice of which primary visual to emit come from the executor and the DB, never the LLM.

---

## 4. Hybrid LLM layer (Phase 6)

The LLM (Qwen3-14B-AWQ, 4-bit, ~10 GB VRAM) lives in the `qwen-eval:nv25.02` Docker container on the 5070Ti. It exposes `POST /render {intent, registry} → {valid, component, props, warnings, errors, retries_used, latency_ms, intent_truncated, model_version}`.

**Hybrid scope:** the LLM's only job today is to **embellish the `AssistantMessage.text`**. It does not pick data-bearing components, and its prop values for data-bearing blocks are ignored — those come from DB rows.

```
backend/app/llm/
├── client.py    # httpx wrapper, returns None on any failure
├── registry.py  # { components: [ { name: "AssistantMessage", props: {...} } ] }
└── adapter.py   # render_assistant_text(client, context)
                 # - sends a 1-shot request
                 # - honors STATUS.md warning codes
                 #   (dangerous_substring→drop, string_too_long→truncate,
                 #    system_prompt_echo→drop)
                 # - returns a sanitized string or None
```

**Feature flag.** `LLM_RENDER_URL` env var in `/home/ubuntu/custom-ui/.env`:

- Set → hybrid on; executor calls adapter for every chat turn; ~1.6 s round-trip.
- Unset/empty → adapter is never constructed; every turn uses the canned `acknowledgement_text(intent)`; ~20 ms response.

**Fallback chain** (transparent to the user):

```
adapter returns None  →  executor uses canned text
httpx timeout/connect → client returns None → adapter None → canned text
LLM returns Alert/valid=false → adapter None → canned text
warning code triggers drop → adapter None → canned text
```

**Known rough edges (flagged, not yet fixed):**
1. The LLM is called with only the parsed intent, not the action outcome. So for denial paths it produces text as if the action succeeded (`"Gate 1 is now opening."` while the Toast says "denied"). Fix is to move the adapter call to after the action, passing outcome + entity snapshot.
2. For `list_gates`, the LLM fabricates gate names ("Gate A, Gate B, Gate C") because the context doesn't include the actual gate rows. Same fix.

---

## 5. Data model

```
users              gates                gate_permissions            access_log
-----              -----                ----------------            ----------
id                 id                   id                          id
username UNIQUE    label                user_id → users.id          gate_id (nullable)
password_hash      status (enum)        gate_id → gates.id          user_id (nullable)
role (enum)        created_at           granted_by → users.id       action (enum)
created_at                              granted_at                  result (enum)
                                        UNIQUE(user_id, gate_id)    message
                                                                    created_at
```

- `role`: `guest` | `user` | `admin`
- `status`: `open` | `closed` | `locked` (locked = admin-only)
- `action`: `open` | `close` | `lock` | `unlock` | `grant` | `revoke` | `query`
- `result`: `success` | `denied` | `error`

**Seed:** 10 gates with human labels (Main Entrance … Reception). Three demo users: `admin/admin123` (full control), `IReallyRock/rockrock` (user with access to gates 5–9), `guest/guest` (read-only).

Enums are declared as `SAEnum(..., native_enum=False, length=16)` to avoid Postgres enum migration pain.

---

## 6. Frontend

```
frontend/
├── src/
│   ├── api/
│   │   ├── client.ts       # fetch wrapper with bearer token
│   │   └── chat.ts         # SSE consumer; normalizes CRLF→LF (sse-starlette spec quirk)
│   ├── stores/
│   │   ├── authStore.ts    # zustand + persist (name: custom_ui.auth)
│   │   ├── gatesStore.ts   # optimistic + server-confirmed gate state
│   │   └── chatStore.ts    # message/block log
│   ├── blocks/
│   │   ├── registry.tsx    # Block union, registry, handlerAllowlist, sanitizer, BlockRenderer
│   │   ├── AssistantMessage.tsx
│   │   ├── GateCard.tsx    # SVG + Framer Motion; scaleX(0.12) with spring {stiffness:140, damping:16}
│   │   ├── GateGrid.tsx    # layout animation
│   │   ├── AccessList.tsx
│   │   ├── Toast.tsx
│   │   └── Alert.tsx       # LLM refusal / neutral notice
│   ├── components/
│   │   ├── ChatInput.tsx
│   │   ├── MessageList.tsx
│   │   ├── Sidebar.tsx
│   │   └── GatePanel.tsx
│   └── views/
│       ├── Login.tsx       # demo chips auto-login (bypasses Chrome pw manager)
│       └── Home.tsx
└── verify/                 # Playwright scripts (gate-gallery, chat-e2e)
```

**Animation ownership:** `GateCard` is the centerpiece — scaleX on the doors with a transform origin at the hinge, denial keyframe shake, locked state with chain overlay. Toasts slide in with an `AnimatePresence`. `MessageList` staggers block entry by 60 ms.

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
├── docker-compose.prod.yml  # db + api services; extra_hosts host-gateway
└── .env (mode 600)          # JWT_SECRET, DB_PASSWORD, LLM_RENDER_URL
```

**Running:**

| Process | Where | Bound to | Restart policy |
|---|---|---|---|
| `custom-ui-db` (postgres:16-alpine) | Docker, compose network 172.19.0.0/16 | internal | `unless-stopped` |
| `custom-ui-api` (uvicorn) | Docker, compose network 172.19.0.0/16 | `127.0.0.1:8000` on host | `unless-stopped` |
| Nginx 1.18 | host | `:80` (redirect) + `:443` (TLS) | systemd |

**Nginx `/api/chat`** has `proxy_buffering off` for SSE streaming. **Nginx `/api/render`** and **`/api/healthz`** proxy to the LLM via `172.19.0.1:8001`. SPA fallback for client-side routing.

**Security headers (Phase 6d):**

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
                         img-src 'self' data: https:; connect-src 'self'; object-src 'none';
                         base-uri 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
```

`unsafe-inline` on `style-src` is required because Framer Motion writes inline `style` attributes for animated values.

---

## 8. LLM tunnel topology

```
┌────────────────────────┐  ssh -R 172.19.0.1:8001:localhost:8001        ┌────────────────────────┐
│  5070Ti (local)        │ ────────────────────────────────────────────▶ │  VPS (secretseasoning) │
│                        │                                                │                        │
│  qwen-eval:nv25.02     │                                                │  tunnel endpoint bound │
│  uvicorn on :8001      │                                                │  on 172.19.0.1:8001    │
│  /render, /healthz     │                                                │                        │
└────────────────────────┘                                                │  ┌─────────────────┐   │
                                                                          │  │ custom-ui-api   │   │
                                                                          │  │ (compose net    │   │
                                                                          │  │  172.19.0.0/16) │   │
                                                                          │  │                 │   │
                                                                          │  │ httpx POST →    │   │
                                                                          │  │ 172.19.0.1:8001 │   │
                                                                          │  └─────────────────┘   │
                                                                          └────────────────────────┘
```

**Gotchas:**

- Tunnel must bind to `172.19.0.1` (compose bridge gateway), not `127.0.0.1` (host loopback) — the api container can't reach loopback.
- Requires `GatewayPorts clientspecified` in the VPS `sshd_config` and a UFW rule `ALLOW 172.19.0.0/16 → 8001/tcp`.
- Inside the container, `host.docker.internal` resolves to `172.17.0.1` (the `docker0` default bridge), **not** `172.19.0.1`. So `LLM_RENDER_URL` uses the IP literal, not the hostname.
- If the tunnel drops, clear `LLM_RENDER_URL` in `.env` or each chat turn pays a ~3 s connect timeout before falling back.

---

## 9. Safety model (per STATUS.md)

Four layers, in the order they run:

1. **Input length cap** — `POST /api/chat` validates `message: Field(max_length=500)`. The LLM wrapper further truncates intent > 1000 chars.
2. **Hardened system prompt (v5)** — the qwen-eval image ships a prompt that refuses role-swap / prompt-leak / meta-commentary and emits a neutral `Alert` for subversion.
3. **Validator** (in qwen-eval) — structural (JSON, top-level keys, component in registry), type, enum, required-prop, duplicate-key checks.
4. **Value sanitizer** (qwen-eval side) — emits warning codes for payload-shaped strings.

**Frontend defenses (Phase 6c):**

- `sanitizeProps` regex-filters every string prop at render time.
- No `eval()`, `new Function()`, `dangerouslySetInnerHTML` anywhere in `frontend/src`.
- Handler props resolve through `handlerAllowlist` (empty today); unknown names are dropped.
- React's default text escaping covers interpolated content; the sanitizer catches any value that would leak into attributes.

**Backend defenses:**

- Adapter drops LLM output on `dangerous_substring` and `system_prompt_echo` warnings; truncates on `string_too_long`.
- Data-bearing props are never LLM-sourced — they come from DB rows inside the executor.
- Actions (DB mutations, authz, access log) never touch the LLM.

**Network defenses:**

- Backend is bound to `127.0.0.1:8000` only; public traffic goes through Nginx.
- Nginx has CSP + nosniff + referrer-policy.
- LLM tunnel is SSH-authenticated (ed25519), bound to a private docker subnet, gated by UFW.

---

## 10. Out of scope (today)

- Full pure-LLM renderer (STATUS.md option 2) — actions stay deterministic.
- Constrained JSON decoding in the LLM — retry-with-feedback is sufficient for the current registry.
- Multi-turn conversation memory — the LLM is stateless by contract.
- ICP filing — a Chinese regulatory step that would make the VPS reliably reachable from mainland China networks; separate infra task.
- Rate limiting, auth MFA, OAuth — demo doesn't need them.
- Scenarios beyond gate control — future scenarios will swap `intents/parser.py` and extend the block registry without rearchitecting the pipeline.
