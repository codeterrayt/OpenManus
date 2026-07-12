# OpenManus — Local-First Autonomous AI Engine

A local Manus AI clone. An autonomous "action engine" that can reason, write
code, execute scripts in a secure Docker sandbox, and browse the web — all
running 100% on your machine.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Orchestrator | Node.js (ESM) |
| LLM | Ollama (local models) |
| LLM API shim | OpenAI SDK → `http://localhost:11434/v1` |
| Database | PostgreSQL |
| Code sandbox | Docker (via `dockerode`) |
| Browser | CloakHQ / CloakBrowser |
| API | Express 5 (SSE streaming) |

---

## Project Structure

```
openmanus/
├── schema.sql            # PostgreSQL schema (run once)
├── .env.example          # Copy → .env and fill in your values
├── package.json
└── src/
    ├── index.js          # Express API server & entry point
    ├── agent.js          # Core reasoning loop (Phase 1)
    ├── config.js         # Centralised config (reads .env)
    ├── db.js             # PostgreSQL pool
    └── tools/
        ├── docker.js     # Docker sandbox (Phase 3)
        ├── browser.js    # CloakBrowser integration (Phase 4)
        └── skills.js     # Skill store CRUD
```

---

## Prerequisites

- **Node.js ≥ 20** and **pnpm**
- **Ollama** running at `http://localhost:11434` with a model pulled (e.g. `qwen2.5:7b`)
- **PostgreSQL** running locally with a `openmanus` database
- **Docker** (Desktop on Windows — enable "Expose daemon on tcp://localhost:2375" in settings)
- **CloakBrowser** running at `http://localhost:9000` *(Phase 4 only)*

---

## Quick Start

```powershell
# 1. Clone / open the project
cd d:\Projects\OpenManus

# 2. Install dependencies
pnpm install

# 3. Set up environment
Copy-Item .env.example .env
# Edit .env with your Postgres password, model name, etc.

# 4. Apply the database schema
psql -U postgres -d openmanus -f schema.sql

# 5. Start the server
pnpm dev
```

---

## API

### `POST /run`
Start an agent session. Streams Server-Sent Events.

```bash
curl -N -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -d '{"goal": "Write a Python script that prints the first 10 Fibonacci numbers and run it."}'
```

**SSE events:**

| Event | Payload |
|---|---|
| `start` | `{ goal }` |
| `chunk` | `{ text }` — partial LLM output |
| `done` | `{ sessionId, result }` |
| `error` | `{ message }` |

### `GET /health`
Returns `{ status: "ok", model: "..." }` when the server and DB are reachable.

### `GET /sessions`
Returns the last 50 sessions (no history/logs — just metadata).

### `GET /sessions/:id`
Returns the full session record including `history` (message array) and `logs` (tool call records).

---

## Agent Tools

| Tool | Description |
|---|---|
| `run_code` | Execute Python/JS in an ephemeral Docker container |
| `browse_web` | Navigate URLs with CloakBrowser (extract text, click, screenshot, bypass challenges) |
| `list_skills` | List all saved workflows from Postgres |
| `get_skill` | Fetch a specific skill's payload |
| `save_skill` | Persist a new reusable workflow |

---

## Docker Sandbox Details

- **Network disabled** inside containers (no outbound calls from sandboxed code)
- **Memory cap**: 256 MB
- **CPU quota**: 50% of one core
- **PID limit**: 64 (prevents fork bombs)
- **Timeout**: 30 seconds (kills and removes container if exceeded)
- Script is injected via a tar archive (no volume mounts needed)
- Container is **force-removed** after every run

---

## Phases Roadmap

- [x] Phase 1 — Orchestrator & LLM routing (Ollama + OpenAI SDK)
- [x] Phase 2 — PostgreSQL schema (sessions + skills)
- [x] Phase 3 — Docker execution sandbox
- [x] Phase 4 — CloakBrowser web navigation
- [ ] Phase 5 — Web UI (chat interface)
- [ ] Phase 6 — Multi-agent task splitting
