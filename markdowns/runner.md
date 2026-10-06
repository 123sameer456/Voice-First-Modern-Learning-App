# runner.md — How to Run the Project

Everything you need to get the AI Learning Experience Engine running locally (and deployed on Vercel).

## Prerequisites

- **Python 3.11+** (a `venv/` is already committed-ready: create with `python -m venv venv`)
- **Node.js 18+** and npm
- **API keys:**
  - `GEMINI_API_KEY` — Google AI Studio (Gemini 3.5 Flash / 3.5 Flash Lite by default; model names are set in `.env`)
  - `ELEVENLABS_API_KEY` — ElevenLabs (TTS voice)

## Required environment variables

Copy `.env.example` to `.env` (repo root) and fill in:

```text
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-3.5-flash            # cheap core model
GEMINI_LITE_MODEL=gemini-3.5-flash-lite  # used for lightweight calls
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=                     # optional; admin panel can change it
JWT_SECRET=generate-a-long-random-secret # REQUIRED in prod (ENVIRONMENT=prod)
JWT_ALG=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7
ENVIRONMENT=dev                          # prod enables security guards
INITIAL_ADMIN_EMAIL=admin@ubl-demo.com
INITIAL_ADMIN_PASSWORD=change-me
DEMO_LEARNER_EMAIL=learner@ubl-demo.com
DEMO_LEARNER_PASSWORD=change-me
MAX_UPLOAD_SIZE_MB=10
FRONTEND_ORIGIN=http://localhost:5173
```

Frontend env (optional, `frontend/.env`):

```text
VITE_API_BASE_URL=/api
```

## Run locally (Windows / PowerShell)

```powershell
# 1. Backend (port 8000) — creates + seeds the SQLite DB on first run
venv\Scripts\python.exe -m uvicorn app.main:app --app-dir api --port 8000

# 2. Frontend (port 5173, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` and sign in:

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@ubl-demo.com | ubl-demo-2026 |
| Learner | learner@ubl-demo.com | learner-demo-2026 |

On first run the backend automatically bootstraps the admin account, the demo learner, settings, and two demo journeys (English + Urdu) from committed seed fixtures — no manual seeding step needed.

## Tests

```powershell
$env:PYTHONPATH = "api"
venv\Scripts\python.exe scripts\smoke_test.py             # auth flows (no external calls)
venv\Scripts\python.exe scripts\test_phase2.py            # real Gemini generation E2E (uses API credits)
venv\Scripts\python.exe scripts\test_phase3.py            # grading, mastery, gamification, voice
venv\Scripts\python.exe scripts\generate_seed_fixtures.py # regenerate demo fixtures (4 Gemini calls)
```

## Deploy to Vercel

1. Push the repo to GitHub (push is done by you, not the agent).
2. In Vercel: import the repo, framework preset **Other** (uses `vercel.json`).
3. Set environment variables (Production + Preview) from the README's Deploy section — critically `ENVIRONMENT=prod`, a strong `JWT_SECRET`, both API keys, admin/learner credentials, and `FRONTEND_ORIGIN`.
4. In production the SQLite DB lives in `/tmp` (ephemeral): the app rebuilds itself from committed seed fixtures on cold start. For real persistence, upgrade to Render Starter + persistent disk (see `render_deployment.md`) or point `DATABASE_URL` at Turso.

## Common issues

- **Login fails / 500 on boot in prod** — `JWT_SECRET` not set (enforced when `ENVIRONMENT=prod`).
- **No voice output** — check `ELEVENLABS_API_KEY`; the learner app falls back to browser TTS if the proxy fails.
- **Journey generation errors** — check `GEMINI_API_KEY` and model names (configurable via `GEMINI_MODEL` / `GEMINI_LITE_MODEL` in `.env`); `gemini-2.5-flash-lite` was retired for new keys — use the `gemini-3.5` family. Generation uses a schema-free JSON fallback mode.
- **DB looks reset after deploy** — expected on Vercel cold starts with `/tmp` storage; see seed.md.
