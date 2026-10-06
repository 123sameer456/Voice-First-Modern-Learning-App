# deployment.md — Deploy to Vercel, Step by Step

A complete, follow-along guide to put the **AI Learning Experience Engine** (React frontend + FastAPI backend) on Vercel. Read `runner.md` first if you haven't run the project locally yet.

## How it's wired for Vercel

Everything is already configured — you don't need to change any code:

- **`vercel.json`** (repo root) does the routing:
  - `/api/*` → the FastAPI app (`api/main.py`, Python serverless function)
  - everything else → the built React app (`frontend/dist`, SPA rewrite)
- **Frontend** — Vercel builds `frontend/` with `npm run build`. It calls the API at `/api` (same origin), so **no frontend environment variable is needed**.
- **Database** — in production the app uses `sqlite:////tmp/app.db`. Vercel's filesystem is ephemeral, so the app **rebuilds itself on cold start**: admin/learner accounts come from your environment variables, and the two demo journeys (English + Urdu) are rebuilt from the committed seed fixtures in `api/app/seed_data/journeys/`. This is perfect for a demo — see "Database persistence" below for the honest caveats.

## Before you start

- A **GitHub repo** with this code (you push it yourself — see step 1).
- A **Vercel account** (free Hobby plan is enough): https://vercel.com/signup
- Your API keys:
  - `GEMINI_API_KEY` — https://aistudio.google.com/apikey (journey generation, study cleanup, quiz, grading)
  - `ELEVENLABS_API_KEY` — https://elevenlabs.io (voice; optional — the app still works without voice)

## Step 1 — Commit and push the repo

The deployment files (`vercel.json`, `api/requirements.txt`, seed fixtures) are already in the repo, so a normal push is enough:

```powershell
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main
```

(If you're reading this before committing recent work: `git status` shows what's pending.)

## Step 2 — Generate a JWT secret

The app **refuses to boot in production** without a real `JWT_SECRET` (`ENVIRONMENT=prod` enforces it). Generate a strong one locally:

```powershell
venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"
```

Copy the output — you'll paste it into Vercel in the next step.

## Step 3 — Import the repo into Vercel

1. Go to https://vercel.com/new
2. **Import** your GitHub repo (grant Vercel access to it if asked).
3. **Framework Preset**: choose **Other** (this makes Vercel use `vercel.json`, which handles both the frontend build and the Python function). Don't pick "Vite" or "React".
4. **Root Directory**: leave as the repo root (the `vercel.json` sits at the root).
5. Don't click Deploy yet — set the environment variables first (next step).

## Step 4 — Set environment variables

In the import screen, expand **Environment Variables** (or later in Project → Settings → Environment Variables, scope **Production** — add them to **Preview** too if you want PR previews to work).

| Name | Value | Required |
| --- | --- | --- |
| `ENVIRONMENT` | `prod` | ✅ yes |
| `JWT_SECRET` | the hex string from step 2 | ✅ yes |
| `GEMINI_API_KEY` | your Google AI Studio key | ✅ yes (AI features) |
| `ELEVENLABS_API_KEY` | your ElevenLabs key | recommended (voice) |
| `FRONTEND_ORIGIN` | `https://<your-project>.vercel.app` | ✅ yes |
| `INITIAL_ADMIN_EMAIL` | e.g. `admin@yourdomain.com` | ✅ yes |
| `INITIAL_ADMIN_PASSWORD` | a strong password (min. 8 chars) | ✅ yes |
| `DEMO_LEARNER_EMAIL` | e.g. `learner@yourdomain.com` | recommended |
| `DEMO_LEARNER_PASSWORD` | a strong password | recommended |
| `MAX_UPLOAD_SIZE_MB` | `10` (default) | optional |
| `GEMINI_MODEL` / `GEMINI_LITE_MODEL` | defaults are already the cheap+fast models | optional |

Notes:

- **`FRONTEND_ORIGIN`**: on Vercel the frontend and API share one origin, so this is mostly for correctness. You won't know the final URL until the first deploy — deploy once with a placeholder, then come back and set the real `https://<project>.vercel.app` (shown after deploy) and **redeploy**. Multiple origins are allowed as a comma-separated list.
- **Admin/learner emails and passwords are bootstrap-only**: they create the accounts when the DB is empty (which on Vercel is every cold start). Changing them later doesn't change existing accounts — use the admin panel's Users page for that. Anyone visiting the site can see only the login page; the credentials you set here are what you share with demo users.

## Step 5 — Deploy and get your URL

1. Click **Deploy**. The build takes a couple of minutes (frontend npm build + Python runtime setup).
2. When it finishes, Vercel shows your URL — `https://<project>.vercel.app`. If you set `FRONTEND_ORIGIN` as a placeholder, update it now to the real URL and **redeploy** (Deployments → ⋯ → Redeploy).

## Step 6 — Verify the deployment

Walk through this checklist in order:

| # | Check | Expected |
| --- | --- | --- |
| 1 | Open `https://<project>.vercel.app/api/health` | `{"status": "ok", "environment": "prod"}` |
| 2 | Open the site, log in with your **admin** credentials | Redirects to `/admin` |
| 3 | Dashboard | Stat cards show users + 2 published demo journeys |
| 4 | Content Studio → add a **Topic** source (50+ chars) → **Generate journey** | Takes up to ~1 minute, then the review panel opens |
| 5 | **Publish** the journey | Visible to learners |
| 6 | Log out → log in with the **learner** credentials | Redirects to `/app` |
| 7 | Journey card → **Start learning** | Clean "AI-tidied" sections; **Listen** plays the material |
| 8 | **Ask questions** → answer by voice or text | Fresh AI questions, verdict + teaching feedback |
| 9 | **Start the test** → complete an activity | XP, mastery panel, badges |
| 10 | Admin → Dashboard | Your interaction shows in stats |

Mic (voice input) notes: the browser's Web Speech API needs **Chrome or Edge** (it does not work in Firefox), and works on HTTPS — the `vercel.app` URL qualifies. Learners without mic support can always type.

## Database on Vercel (important)

The demo runs on an **in-memory SQLite database** — zero external services, zero credentials, zero filesystem. On every cold start the app creates the schema and re-seeds the demo content (accounts, settings, badges, both demo journeys, sample nudges).

- **Reads are stable**: seeded content is always there.
- **Writes live as long as the instance is warm**: learner activity, created users, and newly generated journeys survive between requests but disappear on cold restart/redeploy. With Fluid compute, instances stay warm a long time — in practice the demo holds up fine.

If you need writes to stick permanently, pick one:

| Option | What it takes |
| --- | --- |
| **Render Starter + disk ($7/mo)** | The only way to keep SQLite truly persistent: deploy the backend as a Web Service, upgrade to the Starter plan, attach a persistent disk mounted at `/var/data`, and set `DATABASE_URL=sqlite:////var/data/app.db`. Point the frontend at it with `VITE_API_BASE_URL=https://<render-app>.onrender.com/api` and set `FRONTEND_ORIGIN` to the Vercel URL. (The Render **free** tier does *not* persist SQLite — its filesystem is ephemeral too and free services sleep after 15 min. See `render_deployment.md`.) |
| **Keep Vercel as-is (current)** | Zero work; demo data is self-healing. You can delete the `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `PYTHON_VERSION` env vars — they are no longer used. |

For the challenge demo, the default is the recommended path — mention the persistence design in your presentation as a conscious trade-off.

## Vercel limits to know about

| Limit | Value | Effect on this app |
| --- | --- | --- |
| Function duration | 300s (5 min) on Hobby with Fluid compute | Journey generation (~1 min) fits comfortably |
| Request body size | 4.5 MB (platform cap) | **Keep uploaded documents under ~4 MB** even though the app allows 10 MB — larger files return `413` |
| Cold starts | First request after idle may take a few seconds | Normal; the app re-seeds itself instantly on boot |
| TTS/STT audio | proxied through the function | Fine; server-side caching keeps ElevenLabs costs low |

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `/api/health` returns 500 or the function crashes on boot | `JWT_SECRET` missing while `ENVIRONMENT=prod` (enforced), or a typo in another required env var. Check Vercel → Deployments → Functions logs. |
| Login says "Invalid credentials" | The admin account is created from `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` on an empty DB. Check the values (email is lowercased). |
| "Generating journey…" fails after ~1 min | Check `GEMINI_API_KEY` and Vercel function logs for the Gemini error. Retry — generation is idempotent and the source stays ready. |
| No voice / "voice disabled" chip in Study Mode | `ELEVENLABS_API_KEY` missing, or Voice disabled in Admin → Settings → voice. Reading still works without voice. |
| Upload fails instantly with `413` | Vercel's 4.5 MB body cap — use a smaller document or a Topic/URL source. |
| Data (new journeys, users) disappeared after a while | Expected on Vercel — the `/tmp` DB reset on cold start. See "Database persistence" above. |
| CORS errors in the console | `FRONTEND_ORIGIN` doesn't match the site URL. Set it to the exact `https://<project>.vercel.app` (or add the extra origin, comma-separated) and redeploy. |
| Mic button says voice input isn't supported | Use Chrome/Edge on HTTPS; typing is always available as a fallback. |

## Redeploys

Every push to `main` triggers a new production deployment automatically. Settings changes made in the admin panel are stored in the DB (not env vars) and reset with the demo DB on cold start — that's by design for the demo.

## Cost snapshot (free tier)

- **Vercel Hobby** — $0 (frontend + backend function)
- **Gemini free tier** — journey generation + study features run on `gemini-3.5-flash` / `gemini-3.5-flash-lite` (configurable via `GEMINI_MODEL` / `GEMINI_LITE_MODEL`) with caching where possible
- **ElevenLabs free tier** — TTS uses the cheapest multilingual model (`eleven_flash_v2_5`) with per-text audio caching; STT prefers the free browser Web Speech API
