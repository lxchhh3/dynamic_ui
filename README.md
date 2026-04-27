# dynamic_ui

A demo of an **LLM-driven server-driven UI** pattern. The user types a sentence in natural language; the backend parses the intent, performs the action, and streams UI blocks back over SSE; the frontend renders those blocks through a component registry.

Scenario 1 is literal **gate control** — open / close / lock gates, request access for gates the user lacks permission on, list who can access what, and approve / deny pending requests. The showpiece is the **request sheet**: when access is denied, a modal pops up; the LLM picks which fields it can pre-fill from the user's profile, those rows visually dematerialize into peach particles on popup, and the user only fills the gaps the model couldn't infer.

For the full project pitch (problem framing, three-layer approach, roadmap), see [`custom_ui_doc.md`](./custom_ui_doc.md).

---

## Stack

- **Backend**: Python 3.13, FastAPI, SQLAlchemy 2 (async), Postgres 16, JWT auth, sse-starlette
- **Frontend**: React + Vite + TypeScript, Zustand, Tailwind, Framer Motion
- **LLM**: Qwen3-14B-AWQ on a separate GPU box, exposed via SSH reverse tunnel
- **Infra**: Docker Compose for db + api, Nginx + Let's Encrypt + UFW on the VPS

The action layer (auth, DB mutation, access log) is fully deterministic — the LLM is only used for narration and for picking which form fields it can pre-fill. Data-bearing block props always come from the DB, never from the model.

---

## Repo layout

```
backend/
  app/
    intents/      # parser (regex) + executor (async generator)
    llm/          # adapter, autofill picker, http client, registry
    routers/      # auth, gates, chat
    models.py     # users, gates, gate_permissions, gate_requests, access_log, chat_log
    profiles.py   # MOCK_PROFILES (demo identity blobs the LLM may pre-fill from)
    seed.py       # deterministic demo seed
  tests/          # pytest, 46 cases covering parser + executor + adapter + autofill picker
frontend/
  src/
    blocks/       # React components for every block type in the protocol
    stores/       # zustand slices: auth, gates, chat
    api/          # SSE consumer
    components/   # ChatInput, MessageList, Sidebar, GatePanel
    views/        # Login, Home
  verify/         # Playwright scripts (request-sheet timing, gate panel, zh-input, etc.)
nginx/            # vhost config (CSP, no-cache index.html, reverse-proxy /api/*)
docker-compose.yml          # local dev (Postgres only; backend runs via uvicorn)
docker-compose.prod.yml     # production (db + api containers)
architecture.md             # design notes — block protocol, pipeline, deploy flow, gotchas
custom_ui_doc.md            # public-facing project pitch
```

---

## Quick start (local dev)

Requirements: Docker, Python 3.13, Node 22+.

```bash
# 1. Set up env
cp backend/.env.example backend/.env
# Edit backend/.env — fill POSTGRES_PASSWORD with a real value (and copy
# the same value into DATABASE_URL), generate JWT_SECRET with:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
# Compose is strict-env and will refuse to start if these aren't set.

# Compose reads from backend/.env via this symlink, or just copy:
cp backend/.env .env

# 2. Database
docker compose up -d db

# 3. Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv/Scripts/activate
pip install -e .
python -m app.seed                                  # idempotent demo seed
uvicorn app.main:app --reload --port 8000

# 4. Frontend
cd ../frontend
npm install
npm run dev                                         # http://localhost:5173
```

Demo logins (seeded):

| User | Password | Role | Gates |
|--|--|--|--|
| admin | admin123 | admin | full control |
| nova | nova123 | admin | full control |
| IReallyRock | rockrock | user | 5–9 |
| morgan | morgan123 | user | 3, 8 |
| priya | priya123 | user | 1, 3, 8 |
| dex | dex123 | user | 1, 2, 6, 10 |
| sam | sam123 | user | 9 |
| guest | guest | guest | read-only |

Try: `open gate 7` (works as IReallyRock) → `open gate 4` (denied → request sheet pops up) → log in as admin → `pending requests` → `approve request 1`. Chinese works too: `打开4号门`, `请把6号门关上`, `谁能进入4号门`, `列出所有门`.

---

## Tests

Backend:

```bash
cd backend && pytest
```

Frontend (Playwright, against a running dev server or the prod URL):

```bash
cd frontend && node verify/chat-e2e.mjs
node verify/sheet-erase-timing.mjs    # records a video to verify/out/
node verify/zh-input.mjs              # bilingual smoke
```

---

## LLM integration

Optional and feature-flagged on `LLM_RENDER_URL`. Two distinct uses, both via the same `POST /render` endpoint:

1. **Narration** — `app/llm/adapter.py::render_block` is called once per turn. Text-bearing picks pass through the sanitizer; data-bearing picks have their props replaced with DB-truth values from a server-side snapshot.
2. **Request-sheet autofill** — `app/llm/profile.py::pick_autofill_fields` asks the model which subset of the user's `MOCK_PROFILES` blob it can confidently pre-fill into the request form. The picker intersects the model's pick against a server-side allowlist (`PROFILE_FIELDS`) so the model can only narrow the set, never expand it.

If `LLM_RENDER_URL` is unset or the wrapper is unreachable, the executor falls back to canned text and the request sheet renders empty for the user to fill manually. The site stays fully functional without the LLM.

See [`architecture.md`](./architecture.md) for the wire contract, tunnel topology, and deploy flow.

---

## Status

Scenario 1 (gate control + access requests) is feature-complete and deployed. Phase 7 work — cream skin reskin, request sheet with LLM-driven autofill, Chinese parser support, denial-path always-form — landed in commit [`d61f4f0`](https://github.com/lxchhh3/dynamic_ui/commit/d61f4f0).

Roadmap and v2 scope are tracked separately; the engine concept generalizes to any host application (ERP / CRM / OA / MES) — see `custom_ui_doc.md` for the broader pitch.

---

## License

No license declared yet. If you want to use any of this code, please reach out first.
