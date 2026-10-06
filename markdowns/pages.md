# pages.md — UI Guide: Every Page, Section, Option, and Field

A complete walkthrough of every screen in the app — what each section is for, what every button, field, badge, and number means — for **both the admin panel and the learner app**.

Routes at a glance:

| Role | Route | Page |
| --- | --- | --- |
| both | `/login` | Sign in |
| admin | `/admin` | Dashboard |
| admin | `/admin/content` | Content Studio |
| admin | `/admin/users` | Users |
| admin | `/admin/settings` | Settings |
| learner | `/app` | Home |
| learner | `/app/journeys/:id` | Journey Map |
| learner | `/app/journeys/:id/learn` | Study Mode (Learn) |
| learner | `/app/activities/:id` | Activity Player |
| learner | `/app/nudges` | Nudges |
| learner | `/app/profile` | Profile |

Signing in at `/login` redirects admins to `/admin` and learners to `/app`. There is no signup — accounts are created by an admin (Users page).

---

# ADMIN PANEL

## Sidebar (all admin pages)

| Item | Goes to | Purpose |
| --- | --- | --- |
| Learning Engine | — | Logo/title ("Admin panel" subtitle) |
| Dashboard | `/admin` | Platform health metrics |
| Content Studio | `/admin/content` | Create, review, publish learning journeys |
| Users | `/admin/users` | Manage accounts |
| Settings | `/admin/settings` | Configure content/gamification/adaptive/engagement/voice |
| **Sign out** | `/login` | Ends the session (refresh token revoked) |

---

## 1. Dashboard (`/admin`)

"Platform health at a glance."

### Stat cards (top row)

| Card | Meaning | Hint shown |
| --- | --- | --- |
| **Users** | Total accounts (admins + learners) | "All accounts" |
| **Learners** | Accounts with role = learner | "Role = learner" |
| **Published / draft** | Journey counts by status, e.g. `2 / 1` | "Journeys" |
| **Interactions** | Total activity attempts recorded | "Activity attempts" |
| **Avg. mastery** | Average mastery % across graded attempts (`—` until attempts exist) | "Across graded attempts" |

### Journeys table

One row per journey:

| Column | Meaning |
| --- | --- |
| **Title** | Journey name (from generation) |
| **Status** | `published` (green) = visible to learners; `draft` (grey) = hidden |
| **Activities** | e.g. "8 in 4 concepts" — activity count and concept count |
| **Needs review** | Red badge with the count of flagged activities (0 = plain grey) — flagged = validator found issues like a fabricated source quote |
| **Created** | Date the journey was generated |

### Activities per journey (bar chart)

Top journeys (up to 8) ranked by activity count; bar length is relative to the largest.

### How to measure effectiveness

Reference cards explaining the six metrics this demo is judged on: **Activation** (new learners finishing a first activity), **Engagement** (interactions per learner + streaks), **Mastery** (avg score vs. pass threshold), **Reinforcement** (due reviews completed after 3 days), **Retention** (active again after 7 days), **Content quality** (needs-review count trending down).

---

## 2. Content Studio (`/admin/content`)

The core workflow: **add source → generate journey → review → publish.**

### Section: "Add content source"

**Tabs** (pick how you provide material):

| Tab | Fields | Rules |
| --- | --- | --- |
| **Topic** | *Title* + *Topic text* textarea | Text must be ≥ 50 chars (live counter shows `n/50 characters`, turns green when valid) |
| **Document** | *Title* + *Document* file picker | Allowed: PDF, DOCX, TXT, MD; max size from `MAX_UPLOAD_SIZE_MB` (default 10 MB) |
| **URL** | *Title* + *URL* input | Must be public http(s); private/internal hosts are blocked (SSRF protection) |

- **Title** — the name of the content source (e.g. "Phishing awareness basics"). Required in practice.
- **Add source** button — saves the source and extracts its text. The source then appears in the list below with status `pending` or `ready` (and `error` + message if extraction failed).

### Section: "Content sources" list

Each row shows:

| Element | Meaning |
| --- | --- |
| Type badge | `topic` (blue) / `document` (violet) / `url` (amber) |
| Title | Source name (falls back to "Source #id") |
| Status badge | `ready` (green, text extracted) / `processing` / `pending` / `error` (red) |
| Error text | Shown inline in red if extraction/generation failed |
| `n journeys · created <date>` | How many journeys were generated from this source |

**Buttons per row:**

| Button | What it does |
| --- | --- |
| **Generate journey** | Runs the AI pipeline: extracts concepts (outline call) + activities (call 2) + auto-repair (only if the validator flags issues). Takes up to a minute; the button shows a spinner and "Generating… (up to a minute)". On success the journey panel opens in review mode. |
| **View journeys / Hide journeys** | Toggles the journey review panel(s) for this source |
| **Delete** | Deletes the content source after confirmation (journeys already generated remain) |

### Journey review panel (per journey)

Header: **title** + status badge + red badge `n need review` (count of flagged activities).

**Buttons:**

| Button | Behavior |
| --- | --- |
| **Publish** | Makes the journey visible to learners. If any activities are flagged, a confirmation asks "publish anyway?" |
| **Unpublish** | Hides a published journey from learners (only shown when published) |
| **Delete** | Permanently deletes the journey (confirmation required) |
| **Refresh** | Reloads the journey detail |

**Sections inside the panel:**

- **Objectives** — 2–6 learning goals generated by AI.
- **Glossary** — up to 10 terms with definitions (or "None").
- **Concepts** — numbered cards, each with title + short description.
- **Activities (n)** — accordion list. Collapsed row: `#order`, type badge (`scenario`/`puzzle`/`simulation`/`mission`), `difficulty n/5`, `XP`, and a red **needs review** badge if flagged. Expanded, each activity shows:

| Block | Contents |
| --- | --- |
| **Learner view** | Exactly what learners will see, rendered per activity type (prompt + options / instruction + items / scenario steps / briefing + tasks) |
| **Answer (server-only)** | The grading key as JSON (correct option id(s), solutions, or min_tasks). Learners never receive this — it's stripped from their API responses |
| **Meta** | Validation issues (red list), **Source refs** (verbatim quotes from your source that justify the activity — a fabricated/mismatched quote is what triggers "needs review"), and the raw meta JSON including **model_confidence** (0–1) |

---

## 3. Users (`/admin/users`)

**Create user** button (top right) opens a modal:

| Field | Rules / options |
| --- | --- |
| Email | Required, must be a valid email |
| Password | Required, min. 8 characters |
| Role | `learner` (default) or `admin` |
| Language | `English (en)` or `Urdu (ur)` — the learner's language preference |
| Buttons | **Cancel** / **Create user** |

**Users table** (one row per account):

| Column | Meaning / actions |
| --- | --- |
| **Email** | Account email; your own row gets a `you` chip |
| **Role** | Dropdown `learner`/`admin` — changing it asks for confirmation and takes effect immediately |
| **Active** | Toggle. Off = account cannot log in. You cannot deactivate your own account (tooltip explains) |
| **XP** | Total experience points earned (learners) |
| **Level** | Derived from XP via the level curve |
| **Created** | Account creation date |
| **Actions → Reset password** | Opens a modal to set a new password (min. 8 chars); confirms with "Password updated." |

---

## 4. Settings (`/admin/settings`)

Five tabs. Each tab has its own **Save** button ("Save <group> settings") and only sends **changed keys** (merged server-side). A green "Saved ✓" chip confirms; nothing applies until saved. Changes take effect without any rebuild — generation reads settings live.

### Tab: content

| Field | Meaning | Default |
| --- | --- | --- |
| **Default language** | Language for NEW generated journeys: `English (en)` or `Urdu (ur)` (Urdu uses Urdu script with English technical terms) | `en` |
| **Audience level** | Free text fed to the AI prompt (e.g. general, beginner, professional) | `general` |
| **Tone** | Free text for the AI writing style (e.g. friendly, formal) | `friendly` |
| **Difficulty range** | Min–max difficulty (1–5) the AI may assign to activities | 1–5 |

### Tab: gamification

| Field | Meaning | Default |
| --- | --- | --- |
| **XP per activity (base)** | Base XP; an activity awards base × difficulty | 10 |
| **Level curve (XP per level)** | XP needed per level-up | 100 |
| **Hint cost (XP)** | XP deducted when hints are used | 2 |
| **Streaks enabled** | Toggle daily-streak tracking | on |

### Tab: adaptive

| Field | Meaning | Default |
| --- | --- | --- |
| **Mastery pass percent** | Slider 0–100: the mastery % considered "passed" | 70 |
| **Hint penalty** | Fraction (0–1) subtracted from mastery growth when hints were used | 0.1 |
| **Reinforcement interval (days)** | Days until a completed concept becomes due for review | 3 |

### Tab: engagement

| Field | Meaning | Default |
| --- | --- | --- |
| **Nudges enabled** | Toggle the nudge system | on |
| **Nudge frequency (days)** | How often re-engagement nudges are generated | 7 |
| **Quiet hours** | Window (e.g. `22:00-07:00`) in which no nudges are sent | `22:00-07:00` |

### Tab: voice

| Field | Meaning | Default |
| --- | --- | --- |
| **Voice enabled** | Master toggle for TTS in the learner player | on |
| **Cache TTS audio** | Reuse generated audio for repeated text (saves ElevenLabs credits) | on |
| **TTS model** | ElevenLabs model id (e.g. `eleven_flash_v2_5` — cheapest tier) | `eleven_flash_v2_5` |
| **Voice ID** | Which ElevenLabs voice speaks (from your ElevenLabs dashboard) | empty |
| **Language** | Voice/speech locale: `en` or `ur` | `en` |
| **STT provider** | `browser_first` (free Web Speech API) or `elevenlabs` (paid) | `browser_first` |
| **Stability** | Slider 0–1: higher = steadier, flatter delivery | 0.50 |
| **Similarity boost** | Slider 0–1: how closely it sticks to the original voice | 0.75 |
| **Style** | Slider 0–1: exaggerates expressiveness (higher costs more) | 0 |

---

# LEARNER APP

## Top bar (all learner pages)

Sticky header: **LE** logo + "Learning Engine", then nav: **Home** (`/app`), **Nudges** (`/app/nudges`), **Profile** (`/app/profile`), and **Sign out**.

---

## 1. Home (`/app`)

- **Welcome header** — "Welcome back, {name}!" (name = email prefix).
- **Stat cards** — **Level**, **XP**, **Streak** (days, e.g. `3d`), **Language** (`EN`/`UR`).
- **Resume card** (blue, appears when there's a next best activity) — the adaptive engine's recommended next activity with a **reason** (e.g. "next in your journey", "due for reinforcement"). **Start now →** opens the Activity Player.
- **Reinforcement due card** (amber) — a concept that's due for review, with **Review now →** linking to the recommended activity.
- **Your journeys grid** — one card per published journey: title, description, difficulty dots (average of its activities), and per-type chips like 🎭 Scenario × 2, 🧩 Puzzle × 3, 🧭 Simulation × 1, 🎯 Mission × 1. Click a card to open its Journey Map. Empty state: "When your admin publishes a journey, it will appear here."
- **Card footer buttons** — **📖 Start learning** opens Study Mode (read/listen to the actual material first), **📝 Start the test** opens the Journey Map. Learning is always optional — you can test directly.

---

## 2. Journey Map (`/app/journeys/:id`)

- **Header** — journey title, description, objective chips, and a **📖 Start learning** button that opens Study Mode for this journey's source material.
- **Concept sections** — activities are grouped under their concept title (a "General" group catches ungrouped ones), rendered as a vertical timeline.
- **Activity states**:

| State | Look | Clickable? |
| --- | --- | --- |
| **Done** | Blue check circle, full opacity | No (already completed) |
| **Current** | Glowing ring + "Start →" chip, type icon | Yes — opens the player |
| **Locked** | 🔒, dimmed, "Locked" chip | No — complete the current one first |

Each row also shows a preview (first ~60 chars of the prompt/instruction/briefing) and its XP. Progress comes from the server, with local storage as a fallback. If a journey was unpublished, you get an error card saying so.

---

## 3. Study Mode (`/app/journeys/:id/learn`)

The "learn first" screen opened by **📖 Start learning** (Journey Map header or Home card footer). It shows the actual source material the journey was built from — topic text, uploaded document, or URL content — and offers a voice Q&A tutoring session before the test. Studying is optional: you can skip straight to the test.

### Header
Back-link to the Journey Map (`← {journey title}`), title **"Learn: {source title}"**, and a voice-language chip on the right (`English voice` or `اردو voice` — from admin voice settings, falling back to your profile language).

### Study material card (reading view)

| Element | Meaning |
| --- | --- |
| Type badge | Where the material came from: `topic` (blue) / `document` (violet) / `url` (amber) |
| **✨ AI-tidied** chip | Shown when the material was cleaned by AI: extraction junk (site headers/menus/footers, page numbers, cookie banners…) removed and the content organized into headed sections with clean paragraphs. Without it, the raw extracted text is shown as-is |
| **▶ Listen / ⏸ Pause / ▶ Resume** | Reads the material aloud — the AI-cleaned text only, so the voice never reads navigation or footer junk. Long text is spoken in parts; the part currently being read is highlighted in the pane below |
| **⏮ Prev / Next ⏭** | Skip between spoken parts; **⏹ Stop** returns to the start. `Part n of m` shows your position |
| Reading pane | The material as clean sections: a bold heading per topic and short paragraphs beneath — easy for a layman to follow. Falls back to the raw extracted text (no heading structure) if AI cleanup is unavailable |
| Amber warning | Shown if audio generation/playback fails (e.g. voice settings or credits issue) |
| Grey note | "Voice is currently disabled in settings" — appears when an admin turned voice off; reading still works |

Document audio is generated server-side by ElevenLabs and cached per text chunk, so replaying the same material doesn't cost credits again.

### Actions on the material

| Button | What it does |
| --- | --- |
| **🎤 Ask questions (5 voice questions)** | Starts a fresh AI tutoring quiz — questions are generated new every time (never cached), and questions you already answered this visit are not repeated |
| **Skip — start the test →** | Ignores studying and jumps to the Journey Map to test directly |
| **🔄 Ask new questions** | (After a completed session) starts another fresh quiz round |

### Voice Q&A session (quiz view)

- **"Voice questions"** header with a **Question n of 5** counter and progress dots: blue = current, green = correct answer, amber = wrong answer, small grey = upcoming.
- **Tutor panel** — shows the current question; it is automatically spoken aloud ("🔊 is speaking…" while reading). Questions are answerable from the source material only.
- **Your answer** — speak with **🎙 Answer with voice** (browser mic, live transcript shown) or type in the box. If the browser doesn't support speech input, a note tells you to type instead.
- **Check my answer** — the AI judges your spoken/typed answer against the source (accepting paraphrases, accents, and transcription noise) and shows a verdict card: **✅ Correct!** (green) or **❌ Not quite** (amber) plus a one-sentence teaching explanation — spoken aloud too.
- **Continue →** advances to the next question; on the last question it becomes **Finish ✓**.
- **Drop session** — exits the quiz (after confirmation); progress in that session is lost.

### Completed summary

🎉 **"Session completed!"** with your score ("You answered X of Y correctly") and a per-question review list (question, "You said: …", ✅ Correct / ❌ Learned + the teaching feedback). Buttons: **🔄 Ask new questions**, **📝 Start the test →** (back to the Journey Map), **Home**.

---

## 4. Activity Player (`/app/activities/:id`)

The voice-first screen where activities are completed.

### Header
Back-link to the journey, activity type + XP, and a **Replay** button (🔈 / 🔊 while speaking) that re-reads the prompt aloud. The prompt is also auto-read ~0.4s after load.

### Hints panel (amber)
Appears once you reveal hints — up to **3**, one per click on **💡 Hint (n/3)**. Hints are type-specific nudges (e.g. "Rule out any option that ignores the problem"). Using hints costs XP (gamification setting) and slightly reduces mastery growth (hint penalty).

### Activity body (depends on type)

| Type | What you do |
| --- | --- |
| 🎭 **Scenario** | Read a situation, pick one option (a, b, c, d…) by tapping the row |
| 🧩 **Puzzle — match** | Tap an item, then tap the bucket it belongs to (tap a placed item to unassign) |
| 🧩 **Puzzle — order** | Tap items in the correct sequence (tap a placed item to remove it; later items shift up) |
| 🧭 **Simulation** | Multi-step role play with a progress dots bar ("Step 2 of 3"), one choice per step, **← Back / Next →** navigation |
| 🎯 **Mission** | Read a real-world briefing, check off tasks (checkboxes), success criteria shown on top; counter shows "n of m tasks done" |

### Voice
- **Mic button** (floating, bottom center) toggles listening; while listening, a dark overlay shows the live transcript ("Listening (English)").
- Spoken answers map to choices — say an option's text (or number) for scenarios/simulations; for match-mode puzzles say an item then a bucket; for missions name a task to toggle it. Your browser must support the Web Speech API; otherwise a "use tap inputs" note appears and buttons still work.
- Changing an answer after picking one counts as a **self-correction** (fed into mastery, see below).

### Confidence + submit
- **"How confident do you feel?"** — rate yourself 1–5 stars (required; this is a mastery signal).
- **Submit** enables only when everything above is answered + confidence is set (helper text explains what's missing). During simulations, submit only appears on the final step.
- Submission sends your answer plus learning signals: duration, hints used, self-corrections, confidence.

### Result screen
- 🎉 "Nice work!" (or 💪 "Almost there!" when incorrect), **+XP with count-up animation**, and an optional outcome message.
- **New badge(s) unlocked!** — chips for any badges just earned.
- **Mastery** panel — updated mastery % for the concept, progress bar, and bullet explanation of *why* (correctness, hints, confidence, etc.).
- Buttons: **Back to journey map** / **Home**.

---

## 5. Nudges (`/app/nudges`)

An inbox of re-engagement notifications. Header shows "n unread" or "All caught up ✨".

| Element | Meaning |
| --- | --- |
| Type + icon | `🔥 streak` (streak at risk / extended), `⏰ reminder`, `🔁 reinforcement` (review due), `🏅 achievement` |
| Message | The nudge text |
| Timestamp | When it was sent/scheduled |
| **Mark read** | Marks it read (optimistic UI; unread ones are highlighted, read ones dim) |

Nudge generation frequency and quiet hours come from admin Settings → engagement.

---

## 6. Profile (`/app/profile`)

- **Header** — your name (email prefix) + language preference.
- **Stat cards** — Level, XP, Streak, Language (same as Home).
- **Mastery by concept** — one card per concept you've attempted: title, **Confidence** (how sure the engine is about the estimate), a big % badge (blue ≥ 70, light blue ≥ 40, grey below), and a progress bar. **"Why this level?"** expands the signal breakdown: Correct answers, Hint usage, Self-corrections, Confidence, Time on task.
- **Badges** — grid with `earned/total` counter. Earned = 🏅 with amber ring; locked = 🔒 dimmed with the requirement description.

---

# Quick number glossary

| Number | Where it comes from |
| --- | --- |
| **XP awarded** | `xp_per_activity_base` (Settings) × activity difficulty |
| **Level** | Total XP ÷ `level_curve` (Settings) |
| **Mastery %** | Elo-style update per graded attempt, using correctness, difficulty, hints, self-corrections, and confidence; pass line = `mastery_pass_percent` |
| **model_confidence** | The AI's own 0–1 self-rating of how well an activity is grounded in your source |
| **needs review** | Validator found a problem: missing answer key, fabricated source quote, difficulty outside range, low confidence, etc. |
| **Streak (d)** | Consecutive days with activity (if streaks enabled) |
