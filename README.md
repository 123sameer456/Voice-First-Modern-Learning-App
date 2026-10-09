# AI Learning Experience Engine

Converts any learning topic, document, or public URL into a gamified, adaptive, voice-first learning journey. Built for the Digital HR & AI Manager assignment demo.

## Stack

- **Frontend:** React 18 + Vite + Tailwind (white / light-blue theme) — `frontend/`
- **Backend:** Python FastAPI — `api/` (exposed at `/api/*`)
- **Database:** SQLite3 file (`api/app.db` locally; `/tmp/app.db` in production)
- **AI:** Gemini 2.5 Flash (cost-optimized, thinking disabled) for content understanding + journey generation; ElevenLabs `eleven_flash_v2_5` for TTS via server proxy; free browser Web Speech API for voice input

## Run locally

```powershell path=null start=null
# 1. Backend (port 8000) — creates + seeds the DB on first run
venv\Scripts\python.exe -m uvicorn app.main:app --app-dir api --port 8000

# 2. Frontend (port 5173, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

Sign in at `http://localhost:5173`:

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@demo.com | demo-2026 |
| Learner | learner@demo.com | learner-demo-2026 |

Two demo journeys (English + Urdu) are seeded automatically. Change credentials via `.env` before the first run (`INITIAL_ADMIN_*`, `DEMO_LEARNER_*`).

## Demo walkthrough

1. **Admin → Content Studio:** create a module from a topic, document (PDF/DOCX/TXT/MD), or URL → Generate → review generated journey (grounding flags, answers, source refs) → Publish.
2. **Admin → Settings:** change language (en/ur), tone, difficulty range, gamification, adaptive thresholds, engagement cadence, and all ElevenLabs voice parameters — no rebuild needed.
3. **Learner:** journey map → activity player (scenarios, puzzles, simulations, missions) with mic-first voice, hint ladder, XP/badges/streaks, and "why this level" mastery explanations.
4. **Admin → Dashboard:** engagement, mastery, and completion metrics with CSV-friendly filters.

## Deploy to Vercel

The repo is Vercel-ready (`vercel.json` maps `/api/*` to the FastAPI serverless function and serves the React build).

1. Create a GitHub repo and push this project (push is done by you, not the agent).
2. In Vercel: import the repo, framework preset **Other** (uses `vercel.json`).
3. Set environment variables in the Vercel project (Production + Preview):

```text path=null start=null
ENVIRONMENT=prod
JWT_SECRET=<long random string>
GEMINI_API_KEY=<your key>
ELEVENLABS_API_KEY=<your key>
INITIAL_ADMIN_EMAIL=<your admin email>
INITIAL_ADMIN_PASSWORD=<your admin password>
DEMO_LEARNER_EMAIL=<demo learner email>
DEMO_LEARNER_PASSWORD=<demo learner password>
FRONTEND_ORIGIN=https://<your-project>.vercel.app
```

Notes:
- In production the SQLite DB lives in `/tmp` (Vercel's filesystem is ephemeral): the app rebuilds itself from committed seed fixtures on cold start, so the demo journeys and accounts are always available, but admin-created content/progress resets between cold starts. For persistent storage, point `DATABASE_URL` at Turso (SQLite-compatible, zero code changes).
- Live regeneration of journeys works on Vercel too (uses your `GEMINI_API_KEY`); it just costs a few flash-tier calls.

## Tests

```powershell path=null start=null
$env:PYTHONPATH = "api"
venv\Scripts\python.exe scripts\smoke_test.py            # auth flow
venv\Scripts\python.exe scripts\test_phase2.py           # real Gemini generation E2E
venv\Scripts\python.exe scripts\test_phase3.py           # grading, mastery, gamification, voice
venv\Scripts\python.exe scripts\generate_seed_fixtures.py  # regenerate demo fixtures (2 journeys, 4 Gemini calls)
```

## Regenerating demo fixtures

The committed fixtures in `api/app/seed_data/journeys/` power cold-start seeding. To regenerate with new topics, edit `scripts/generate_seed_fixtures.py` and re-run it.
