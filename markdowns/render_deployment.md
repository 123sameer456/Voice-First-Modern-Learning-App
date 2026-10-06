# render_deployment.md — Deploy on Render (Free Tier) + Vercel vs Render

A step-by-step guide to host the AI Learning Experience Engine on Render's free tier, followed by an honest **Vercel vs Render** comparison so you can pick the right home for the demo.

## TL;DR — which one is better for this demo?

**Keep the app on Vercel as deployed (`deployment.md`).** Render's free tier gives you a long-running server (nice in theory) but adds a ~1-minute cold start after just 15 minutes of idling — painful when a panel opens your link — and its free filesystem is just as ephemeral as Vercel's. Nothing actually persists on the Render free tier either.

| | **Vercel (current)** | **Render free** |
| --- | --- | --- |
| Cold start | ~1–3 s (serverless, near-instant) | **~1 minute** after 15 min idle (visible loading page) |
| Always-on for a live demo | ✅ yes | ⚠️ only if kept warm (see pinger trick below) |
| SQLite data persists | ❌ resets on cold start (self-reseeds) | ❌ **resets on spin-down/redeploy/restart too** — free tier has no persistent disk |
| True persistence | Turso (extra setup) or paid host | ✅ paid Starter plan + persistent disk ($7/mo) |
| Free-hours budget | Not applicable (serverless) | 750 instance-hours/month — one 24/7 service barely fits (~744 h) |
| Compute | Auto-scales | 0.1 CPU, 512 MB — fine for this app (AI calls are I/O) |
| Setup effort | Zero (already configured) | Moderate (two services, CORS, frontend env) |
| One URL for frontend + API | ✅ same origin (`/api`) | ❌ two URLs → CORS + `VITE_API_BASE_URL` config |
| **Verdict for the demo** | **Recommended** — instant, self-healing, zero config | Use only if you specifically want a long-running process demo or plan to upgrade to Starter + disk |

Real persistence on either platform's free tier is off the table — the honest upgrade path is **Render Starter ($7/mo) + persistent disk**, which this guide includes as an optional final step.

## Render architecture (what you'll deploy)

Two free services from the same GitHub repo:

1. **Web Service (API)** — FastAPI via Uvicorn, long-running Python process.
2. **Static Site (frontend)** — `npm run build`, published from `frontend/dist`.

They'll be on different URLs (`*.onrender.com`), so the frontend must know the API URL at build time and the API must allow the frontend origin (CORS).

## Step 1 — Push the repo

```powershell
git add .
git commit -m "Add Render deployment support"
git push origin main
```

## Step 2 — Create the API Web Service

1. Sign in at https://dashboard.render.com → **New → Web Service**.
2. Connect your GitHub repo (`123sameer456/ubl-challenge`).
3. Configure:

| Setting | Value |
| --- | --- |
| **Name** | `learning-engine-api` (the URL becomes `https://learning-engine-api.onrender.com`) |
| **Language / Runtime** | Python 3 |
| **Root Directory** | leave blank (repo root) |
| **Build Command** | `pip install -r api/requirements.txt` |
| **Start Command** | `uvicorn app.main:app --app-dir api --host 0.0.0.0 --port $PORT` |
| **Instance Type** | Free |
| **Health Check Path** | `/api/health` |

4. Under **Environment**, add the variables below (same values as your Vercel project):

| Name | Value |
| --- | --- |
| `ENVIRONMENT` | `prod` |
| `JWT_SECRET` | your generated hex secret (required — app refuses to boot in prod without it) |
| `GEMINI_API_KEY` | your Google AI Studio key |
| `ELEVENLABS_API_KEY` | your ElevenLabs key |
| `GEMINI_MODEL` | `gemini-3.5-flash` |
| `GEMINI_LITE_MODEL` | `gemini-3.5-flash-lite` |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | your admin credentials (bootstrap only) |
| `DEMO_LEARNER_EMAIL` / `DEMO_LEARNER_PASSWORD` | your demo learner credentials |
| `FRONTEND_ORIGIN` | fill in after step 3 (the static site URL) |
| `DATABASE_URL` | **don't set it** — the default (`sqlite:///api/app.db`) is right for the free tier |

5. Click **Create Web Service**. First build takes a few minutes.
6. Verify: open `https://learning-engine-api.onrender.com/api/health` → `{"status": "ok", "environment": "prod"}`.

## Step 3 — Create the frontend Static Site

1. Dashboard → **New → Static Site** → same repo.
2. Configure:

| Setting | Value |
| --- | --- |
| **Name** | `learning-engine-app` |
| **Root Directory** | leave blank |
| **Build Command** | `cd frontend && npm install && npm run build` |
| **Publish Directory** | `frontend/dist` |

3. Add the build-time environment variable (Static Site → Environment):

| Name | Value |
| --- | --- |
| `VITE_API_BASE_URL` | `https://learning-engine-api.onrender.com/api` |

   ⚠️ This is a **build-time** variable (baked into the JS bundle). If you change it later, **trigger a redeploy** of the static site.
4. Click **Create Static Site**.
5. Copy the site URL (e.g. `https://learning-engine-app.onrender.com`), then go back to the **API Web Service → Environment** and set:

```
FRONTEND_ORIGIN=https://learning-engine-app.onrender.com
```

   Save — Render redeploys the API automatically. (Multiple origins, e.g. local dev + prod, are comma-separated.)

## Step 4 — Verify

| # | Check | Expected |
| --- | --- | --- |
| 1 | `https://<api>.onrender.com/api/health` | `{"status": "ok", "environment": "prod"}` |
| 2 | Open the static site, log in as admin | Redirects to `/admin` with 2 demo journeys |
| 3 | Content Studio → generate + publish a journey | ~1 min generation |
| 4 | Learner login → **Start learning** → Listen / Ask questions | AI-tidied content, voice works |
| 5 | Complete an activity | XP + mastery update |

## Step 5 — Keep it warm for demo day (optional)

Free services sleep after **15 minutes** without traffic and take **~1 minute** to wake. To avoid a dead minute in front of an audience, keep the API warm during the demo by pinging it in a background tab (any page refresh works) or use a free uptime pinger (e.g. cron-job.org or UptimeRobot hitting `/api/health` every 10 minutes).

Honest caveats: even kept warm, Render **may restart a free service at any time**, and every restart/redeploy wipes the SQLite file — the app re-seeds itself from fixtures on boot, but learner-created data is gone. Free instance hours (750/month) cover one service awake 24/7 for a month (~744 h) — a second always-on service would exceed it.

## Step 6 — (Optional) Real persistence with Render Starter ($7/mo)

The only free-hobby-budget way to make SQLite genuinely persist on Render:

1. Web Service → **Change plan → Starter**.
2. Web Service → **Disks** → **Add disk**: mount path `/var/data`, size 1 GB.
3. Set environment variable `DATABASE_URL=sqlite:////var/data/app.db` and redeploy.

Now the DB survives redeploys and restarts. Note: a disk pins the service to a single instance and disables zero-downtime deploys (fine here).

## Vercel vs Render — decision table

| Scenario | Use |
| --- | --- |
| Challenge demo with seeded content, quick load, zero maintenance | **Vercel (already deployed)** |
| Live panel demo where you control timing and want the backend "warm" | **Vercel** still wins (no 1-min cold start) |
| You want admin-created journeys/learners to survive across sessions | **Render Starter + disk** ($7/mo), or Turso behind Vercel |
| You want to show a classic always-on server architecture in the presentation | **Render free** — acceptable, but rehearse with the pinger trick |
| Lowest effort | **Vercel** — it's already configured and deployed |

## Troubleshooting (Render)

| Symptom | Fix |
| --- | --- |
| API returns 500 / crashes on boot | `JWT_SECRET` missing with `ENVIRONMENT=prod`, or a bad env var. Check **Logs** in the dashboard. |
| Frontend loads but API calls fail (CORS) | `FRONTEND_ORIGIN` on the API doesn't exactly match the static site URL. Update and redeploy. |
| "Failed to fetch" on login, works in a new tab | API is spinning up from idle (~1 min). Wait and retry; see the pinger trick. |
| API env var changes don't appear | Render redeploys on save — check the deploy finished. |
| Data disappeared | Free-tier filesystem is ephemeral (spin-down/restart/redeploy). See Step 6 for real persistence. |
