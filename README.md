# Agentic AI for Real-Time Personal Schedule Execution Management

MSc project prototype: a multi-agent LLM system that builds a time-blocked
daily schedule from a voice/text morning intake, syncs it to Google
Calendar, and re-optimizes it in real time when disruptions occur —
configurable between a single-agent ReAct architecture and a hierarchical
multi-agent architecture for the RQ1 experimental comparison.

## Structure

```
backend/   FastAPI + LangGraph agent pipeline + deterministic scheduling engine
web/       React + TypeScript companion app (intake, confirmation, audit trail)
```

## Backend quickstart

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env          # fill in GEMINI_API_KEY etc.
pytest                        # deterministic engine tests — no API key needed
uvicorn app.main:app --reload --port 8000
```

`GET /health` and `POST /intake` are live once the server is up. The
`ORCHESTRATION_MODE` env var (`react` | `hierarchical`) is the RQ1
condition switch.

## Web companion quickstart

```bash
cd web
npm install
npm run dev        # http://localhost:5173, proxies to backend on :8000
```

## Build status

See the project task list (Steps 1–10) for what's scaffolded vs. still to
build — Steps 1–2 (backend skeleton, deterministic scheduling engine +
tests) are complete and runnable without any API keys. Steps 3+ (LLM
agents, calendar integration, benchmark harness, study instrumentation)
need `GEMINI_API_KEY` / Supabase / Google OAuth credentials wired in
before they run end-to-end.
