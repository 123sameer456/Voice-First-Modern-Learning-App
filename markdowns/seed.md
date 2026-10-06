# seed.md — Seed, Mock, and Real Data Explained

What data exists in the app, where it comes from, and what's real vs prepared.

## The three kinds of data

### 1. Seed data (committed demo content — what you see on first run)

**What:** everything a fresh install needs to look alive with **zero API calls on boot**:

- Admin account + demo learner account (from `INITIAL_ADMIN_*` / `DEMO_LEARNER_*` env)
- Default settings row
- **Two complete demo journeys** committed as JSON fixtures in `api/app/seed_data/journeys/`:
  - `fire-safety-en.json` — English fire safety journey
  - `time-management-ur.json` — Urdu time management journey

**Where it comes from:** the fixtures were generated **once** by `scripts/generate_seed_fixtures.py`, which called real Gemini (2 calls per journey: outline + activities) and dumped the validated results to JSON. The JSON is committed to the repo.

**When it's used:** on every **cold start** the backend checks if the DB is empty and, if so, parses + inserts these fixtures. Locally that's the first `uvicorn` run; on Vercel it's every cold start (since `/tmp` storage resets).

**Why:** guarantees the demo always works — even with no API keys, no network, or a fresh serverless instance — while still being real AI-generated content quality.

### 2. Mock data (none in the runtime)

The app ships **no hardcoded mock content** in the API or UI. Journeys, activities, answers, badges, settings — all live in the database, either from seed fixtures or created at runtime. The only "prepared" artifacts are the seed fixture JSONs above (which are real Gemini output, just captured). Test scripts use throwaway in-memory DBs, not mock app data.

### 3. Real data (created at runtime)

**What becomes real once you use the app:**

- **Journey generation:** admin creates a module from a topic/doc/URL → the backend calls **real Gemini** (2 flash-tier calls) → the resulting journey is stored in SQLite. This works locally and on Vercel.
- **Learner progress:** every answer is graded server-side, updating real mastery (Elo), XP, badges, streaks, and nudges in the DB.
- **Voice:** TTS audio is real ElevenLabs output streamed through the backend proxy; STT uses the browser's real Web Speech API.

## Quick reference

| Kind | Source | Lives in | Costs API credits | Survives DB reset |
| --- | --- | --- | --- | --- |
| Seed | Gemini-generated once, committed as JSON fixtures | `api/app/seed_data/journeys/` | No (at boot) | Yes (re-seeded on cold start) |
| Mock | — | — | — | — |
| Real | Live Gemini/ElevenLabs calls + learner activity | SQLite DB | Yes (per call) | Locally yes; on Vercel only within a warm instance (use Turso for persistence) |

## Regenerating seed fixtures

Edit `scripts/generate_seed_fixtures.py` (change topics/languages) and re-run:

```powershell
$env:PYTHONPATH = "api"
venv\Scripts\python.exe scripts\generate_seed_fixtures.py
```

This makes 4 Gemini calls (2 per journey) and overwrites the JSON fixtures — commit the results so future cold starts seed the new content.
