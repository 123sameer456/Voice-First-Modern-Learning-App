# about.md — Features, Purpose, Security, and Usage

What the AI Learning Experience Engine does, how each feature works, why it exists (assignment context), and how to use it. For run instructions see `runner.md`; for the demo-data model see `seed.md`.

## What it is

A web app that converts any learning topic, document, or public URL into a **gamified, adaptive, voice-first learning journey**. Built for the Digital HR & AI Manager assignment demo: L&D teams (admins) generate personalized learning experiences with AI; employees (learners) consume them through an engaging, adaptive journey. Theme: white / light blue.

## Tech stack

- **Frontend:** React 18 + Vite + Tailwind (`frontend/`) — learner app + admin panel
- **Backend:** Python FastAPI (`api/`, served at `/api/*`)
- **Database:** SQLite3 via SQLAlchemy (`api/app.db` locally, `/tmp/app.db` on Vercel)
- **AI:** Gemini 2.5 Flash (cost-optimized, thinking disabled) for ingestion + journey generation; ElevenLabs `eleven_flash_v2_5` for TTS through a server proxy; free browser Web Speech API for voice input

## Architecture overview

Admin creates content (topic/doc/URL) → ingestion extracts text + SSRF protection → Gemini generates journey outline (concepts) + heterogeneous activities (scenarios, puzzles, simulations, missions) with answers and source refs → admin reviews + publishes to SQLite. Learner opens the map, picks activities, completes them with voice, gets graded, earns XP/badges/streaks based on adaptive Elo mastery + nudges. All voice parameters configurable via admin settings without rebuild.

## Feature catalog

### Admin panel (`/admin`)

| Page | Purpose | How it works |
| --- | --- | --- |
| **Content Studio** | Create, review, publish journeys | Topic/doc/URL → ingestion extracts text → Gemini generates outline + heterogeneous activities with answers + source refs → review grounding flags/answers → Publish makes it visible to learners |
| **Users** | Manage learner/admin accounts | Admin-created accounts only (no public signup) — see Security |
| **Settings** | Configure everything without rebuild | Language (en/ur), tone, difficulty range, gamification toggles, adaptive thresholds, engagement cadence, and all ElevenLabs voice parameters (voice ID, speed, stability, etc.) stored at runtime |
| **Dashboard** | Monitor the cohort | Engagement, mastery, and completion metrics with CSV-friendly filters |

### Learner app (`/app`)

| Page | Purpose | How it works |
| --- | --- | --- |
| **Journey Map** | Visual path through a published journey | Shows concepts/activities in order with progress and current mastery level |
| **Activity Player** | Complete activities | Voice-first interaction (mic + Web Speech API), hint ladder (progressive hints before answers), adaptive difficulty based on mastery, mastery hints explaining "why this level" |
| **Nudges** | Engagement inbox | Personalized re-engagement nudges per configured cadence |
| **Profile** | Gamification summary | XP, badges, streaks, mastery per concept |

### Adaptive engine (backend)

- **Mastery (Elo):** every graded answer updates per-concept Elo-style mastery; correct answers at higher difficulty move you faster.
- **Gamification:** XP awards, badge unlocks, daily streaks.
- **Nudges:** engagement nudges per configured cadence.
- **Grading:** server-side against generated answer keys; answers never sent to client on fetch (stripped in learner API).

### Voice

- **Text-to-speech:** learner calls `/api/voice` proxy → backend calls ElevenLabs + streams audio. Voice parameters (ID, speed, stability) configurable via Settings.
- **Speech-to-text:** free browser Web Speech API (mic-first UX).

## Security design

| Control | Purpose |
| --- | --- |
| **JWT auth + refresh rotation** | 15 min access tokens + rotating 7-day refresh tokens with logout revocation — limits token replay |
| **RBAC (admin vs learner)** | Route-level role checks; learners get filtered payloads |
| **bcrypt hashing** | Passwords never plaintext |
| **Admin-created accounts only** | No public signup — HR/L&D demo should not open to strangers |
| **Rate-limited login** | Slows credential-stuffing/brute-force |
| **SSRF protection** | URL ingestion blocks private/loopback/metadata IPs and non-HTTP schemes |
| **Server-side AI keys** | Gemini/ElevenLabs keys in backend env only; frontend talks to proxies |
| **Answers stripped** | Correct answers removed server-side before learner fetch |
| **Upload size cap** | Guards against oversized-file abuse |
| **CORS restricted** | Only the deployed frontend may call the API |
| **Prod hardening** | `ENVIRONMENT=prod` requires `JWT_SECRET`, hides `/docs`, uses `/tmp` for Vercel ephemeral FS |
| **Parameterized ORM** | No raw SQL, so SQL injection is structurally avoided |

## How to use (demo walkthrough)

1. **Sign in as admin** → Content Studio → topic/doc/URL → **Generate** → review journey (grounding flags, answers, refs) → **Publish**.
2. **Admin → Settings** → change language (en/ur), tone, difficulty, gamification, adaptive thresholds, cadence, voice params — no rebuild.
3. **Sign in as learner** → pick journey → complete activities with mic → use hint ladder → earn XP/badges/streaks → check nudges + profile.
4. **Admin → Dashboard** → engagement, mastery, completion; filter + export.

See `runner.md` to boot and `seed.md` to understand demo data on first run.
