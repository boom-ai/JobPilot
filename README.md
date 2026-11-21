# Job Pilot AI

A personal AI job-search agent. It finds jobs, scores them against your real resume, tailors an ATS-friendly resume per job (with a truth check), writes cover letters and application answers, prepares and — where permitted — submits applications, then tracks everything through interviews and offers.

Built with Next.js 16, TypeScript, Tailwind v4, Supabase (Postgres + Auth + Storage + RLS), Gemini/OpenAI, Playwright, and a Chrome extension.

---

## Contents

1. [What it does](#what-it-does)
2. [Quick start — local mode (no accounts needed)](#quick-start--local-mode)
3. [Production setup — Supabase + Vercel + local worker](#production-setup)
4. [Required keys & integrations](#required-keys--integrations)
5. [Chrome extension](#chrome-extension)
6. [How automation works (and its safety rules)](#how-automation-works)
7. [Job sources: what is automated and what isn't](#job-sources)
8. [Architecture](#architecture)
9. [Testing — what was actually run](#testing)
10. [Known limitations & next steps](#known-limitations--next-steps)

---

## What it does

| Area | What's implemented |
|---|---|
| **Resume Studio** | Upload multiple PDF/DOCX resumes → structured career profile (rule-based parser, plus AI extraction that is cross-checked against the file text). Fully editable master profile. Unknown fields (e.g. missing LinkedIn URL) are flagged, never guessed. |
| **Discover Jobs** | Multi-source search (public APIs, RSS, Greenhouse/Lever/Ashby/Workday career boards), normalisation, cross-source dedupe, filters, 8 saved presets (editable, cloneable, schedulable), manual add by URL (reads schema.org JobPosting) or paste. |
| **Filters** | Location (cities, remote/hybrid/on-site, India-only, international remote), employment type, salary (LPA, USD, undisclosed, currency conversion with your rate), experience bands + custom, roles, skills, industries, company size, degree, visa, Easy Apply, AI-related, non-technical, non-coding, date posted, deadline, min score, exclusions, applied/rejected/duplicates. Persisted. |
| **AI Matches** | Transparent 0–100 score from 10 configurable weighted factors; Excellent/Strong/Moderate/Low thresholds; why-you-match, strengths, missing qualifications, risk factors; optional AI job analysis (requirements, gaps, red flags). |
| **Resume tailoring** | Per job: reorders sections/bullets/skills by relevance, keeps only relevant projects, optional AI rewording. **Truth guard** rejects any AI rewrite that adds numbers, skills or claims not in the source bullet; employers/titles/dates always come from your profile. Editor with undo/redo, section reorder/hide, bullet edit/add/delete, word-level compare, preview, PDF + DOCX export (`Company_JobTitle_Resume_Date`), version history. |
| **Cover letters** | Full letter, short intro, recruiter message, LinkedIn note, email application; formal/concise/professional/conversational/custom tone; edit, copy, export DOCX/PDF/TXT. Unknowns flagged as `[[UNKNOWN: …]]`. |
| **Application answers** | Standard + pasted questions. Uses your verified answer library first, then profile/preferences, then AI grounded in your profile. Approve, edit, save to library. |
| **Application Queue** | Approval queue (filled-form review, missing fields, legal declarations), browser-worker queue, ready-to-apply packages. |
| **Automation** | Manual / Assisted / Auto modes, thresholds (90+ auto where permitted, 80–89 approval, <80 never), daily/weekly/per-company/per-source limits, start/pause/resume/stop + visible emergency stop. |
| **Browser Workspace** | Tabs, address bar, back/forward/reload, bookmarks, history, job-context side panel (score, resume, letter, answers). Embeds pages that allow it; for sites that block embedding (most portals) it says so, shows a reader view and opens the live page in your browser where the extension assists. |
| **Applications** | Table, Kanban (drag & drop) and Calendar (applied, interviews, follow-ups, deadlines). Full status set, recruiter, notes, follow-ups, history. Never marks “applied” without your confirmation or a detected confirmation page. |
| **Interview Center** | Rounds, scheduling, notes, 24h reminders, prep guide (company/role overview, JD analysis, likely questions, STAR answers built from your real experience, questions to ask, checklist). |
| **Company intelligence** | Gemini with Google Search grounding: verified facts shown with sources; everything else labelled as inference. |
| **Agent** | Task queue (search, analysis, tailoring, letters, preparation, submission, monitoring, notification) with logs, retries with backoff, cancel, pause/resume, stale-task recovery; activity feed generated only from real operations. |
| **Notifications** | In-app (bell), optional Telegram and Discord; per-type preferences. |
| **Analytics** | Per week/month, score distribution, response/interview/offer rates, median time-to-response/interview, source/role/resume-version performance, companies — from real records only, with date ranges. |
| **Security & privacy** | Supabase Auth, RLS on every table, private storage bucket, server-side AI calls, AES-256-GCM encrypted secrets, hashed extension tokens, SSRF-safe URL fetching, full JSON export, scoped deletion. |

---

## Quick start — local mode

No Supabase, no keys. Single user, data in `./.jobpilot-local/`. Good for trying it out on your own PC.

```bash
git clone https://github.com/boom-ai/JobPilot.git
cd JobPilot
npm install
cp .env.example .env.local
# edit .env.local: set APP_ENCRYPTION_KEY to any 32+ random characters, and JOBPILOT_LOCAL_MODE=1
npm run build && npm start        # or: npm run dev:local
```

Open http://localhost:3000 → **Resume Studio** → upload your resume → **Discover Jobs → Search sources**.

To fill and submit forms automatically, run the worker in a second terminal (it uses your installed Chrome):

```bash
npm run worker
```

Optional: add a free Gemini key in **Settings → AI** (get one at https://aistudio.google.com) for AI rewording, analysis and grounded company research. Everything else works without it.

---

## Production setup

### 1. Supabase (free tier)

1. Create a project at https://supabase.com.
2. **SQL Editor →** paste and run `supabase/migrations/0001_init.sql`. This creates all tables, indexes, constraints, Row Level Security policies, and the private `resumes` storage bucket.
3. **Authentication → URL configuration:** set the Site URL to your app URL and add `https://YOUR-APP/auth/callback` to the redirect URLs.
4. **Project Settings → API:** copy the URL, the `anon` key and the `service_role` key.

### 2. Vercel (free tier)

1. Import the GitHub repo in Vercel.
2. Add the environment variables from `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`. `GEMINI_API_KEY` is optional; you can also add the key per user in Settings.
3. Deploy, open the app, create your account and upload your resume.

### 3. Scheduling

- `vercel.json` runs `/api/cron` once a day, the free Hobby-plan maximum.
- `.github/workflows/agent-cron.yml` calls it **every 3 hours for free**. Add the repo secrets `APP_URL` and `CRON_SECRET`.
- Each tick queues due saved searches and a status-monitoring pass, then processes non-browser tasks.

### 4. Local browser worker (for assisted / auto applications)

Form filling needs a real browser, so it runs on your computer, not on Vercel:

```bash
# .env.local on your PC with the same Supabase URL + SUPABASE_SERVICE_ROLE_KEY + APP_ENCRYPTION_KEY
npm install
npm run worker
```

It opens Chrome with its own profile under `worker-data/`, so your sign-ins stay in the browser and Job Pilot never stores passwords. It also processes searches and runs scheduled jobs while it's running.

---

## Required keys & integrations

| Key | Required? | Where | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production | Supabase → API | DB, auth, storage |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Supabase → API | Worker/cron, encrypted secrets. **Server only.** |
| `APP_ENCRYPTION_KEY` | Yes | any 32+ random chars | Encrypts AI keys / bot tokens at rest |
| `CRON_SECRET` | Production | any random string | Protects `/api/cron` |
| Gemini API key | Optional | aistudio.google.com | AI extraction, rewording, analysis, grounded research (free tier is enough) |
| OpenAI API key | Optional | platform.openai.com | Alternative provider |
| Telegram bot token + chat id | Optional | @BotFather | Notifications |
| Discord webhook | Optional | Discord channel settings | Notifications |

---

## Chrome extension

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension/` folder.
2. In Job Pilot, go to **Settings → Chrome extension → Create token**.
3. Click the extension icon, then paste your app URL and the token. Chrome asks permission for that one origin only.

On any job page (LinkedIn, Naukri, Indeed, Foundit, Glassdoor, Wellfound, Greenhouse, Lever, Ashby, or any page with JobPosting data), the popup:

- detects the job and shows its match score, status, tailored resume, cover letter and answers;
- offers **Save Job**, **Analyze**, **Tailor Resume** and **Prepare Application**;
- on application forms, offers **Fill this form**: it fills verified data and approved answers, attaches the tailored PDF where the form accepts uploads, and highlights the submit button. **It never clicks submit.**
- records "applied" only when you tick *I submitted this application* or it detects a confirmation message.

Permissions are `storage`, `activeTab` and `scripting`, plus host access to your app URL only.

---

## How automation works

```
Scheduled / manual search → normalise → dedupe → filter → score
   → AI analysis (score ≥ Moderate, if AI configured)
   → tailor resume (score ≥ auto-tailor threshold)
   → prepare package: cover letter + answers
   → route:
       mode=manual or unsupported site or score < 80 → "Ready to apply" (you apply; extension assists)
       mode=assisted, supported ATS, score ≥ 80       → worker fills form → "Awaiting approval" → you approve → worker submits
       mode=auto, supported ATS, score ≥ 90           → worker fills and submits within limits
```

Rules the worker always follows:

- It submits only on Greenhouse / Lever / Ashby forms you have allowed in Settings.
- It **pauses** at any CAPTCHA, notifies you, and waits for you to solve it in the visible browser. It never attempts to solve one.
- It pauses at login/MFA screens.
- It never submits when a required field has no verified answer; the job goes to the approval queue with the missing fields listed.
- It never ticks legal declarations ("I certify…", consent, terms) unless you approve them for that application or turn on the global setting.
- It never fills voluntary self-identification fields (gender, ethnicity, disability, veteran status).
- It records "applied" only when a confirmation page is detected. Otherwise it flags the job for you to verify.
- Daily, weekly, per-company and per-source limits are checked again right before submitting.
- Emergency stop cancels all queued and running tasks, and the worker aborts before submitting.
- Duplicate applications are blocked.

---

## Job sources

| Source | How | Status |
|---|---|---|
| Remote OK | Public JSON API | Implemented; tested against fixture data in the documented format, **not tested live** |
| Remotive | Public API | Same |
| We Work Remotely | Public RSS | Same |
| Himalayas | Public API | Same |
| Arbeitnow | Public API | Same |
| Greenhouse boards | Public Job Board API, per company token | Same (default boards: `scaleai`, `anthropic`; edit in Settings → Sources) |
| Lever | Public Postings API, per company | Same |
| Ashby | Public Posting API, per board | Same |
| Workday | Public CXS endpoint behind career sites | Implemented; **untested**, tenants vary |
| LinkedIn, Naukri, Indeed, Foundit, Glassdoor, Wellfound, Instahyre, Hirist, Cutshort, FlexJobs | **Manual / browser-assisted.** The app builds search links; the extension captures jobs as you browse. | Their terms prohibit scraping and automated applications, and some have no public job API. Job Pilot does not bypass their anti-bot systems. |
| Company career pages | "Add job" by URL (reads schema.org JobPosting) or the extension | Implemented |

Each source runs independently. A failure is recorded per source and never stops the rest of the search. **Settings → Sources** shows each source's status from its last real run.

---

## Architecture

```
src/
  app/                    Next.js App Router pages + /api route handlers
  components/             UI kit (ui.tsx), shell, job cards, filters, job browser
  lib/
    resume/               parse (rules), extract (PDF/DOCX), tailor (+ truth guard), export (PDF/DOCX)
    matching/             score, filters, dedupe
    sources/              adapters + runner
    ai/                   provider layer (Gemini / OpenAI) + generators (letters, answers, prep, intel)
    agent/                queue, runner, pipeline, services, events/notifications, records
    supabase/             clients, browser client, localdb (local mode)
src/proxy.ts              session refresh + auth redirect (Next 16 "proxy", formerly middleware)
worker/                   local worker: queue loop, scheduler, Playwright ATS handler, form filler
extension/                Chrome MV3 extension
supabase/migrations/      schema + RLS + storage
tests/                    vitest unit/integration/browser tests + fixtures
scripts/                  e2e.mjs (API end-to-end), test-migrations.sh
```

Notes on schema choices relative to the spec:

- `users` is Supabase's `auth.users`.
- `jobs` has a `user_id` because scores are personal.
- Extra tables support the features: `cover_letters`, `answer_library`, `agent_state`, `agent_events`, `bookmarks`, `browser_history`, `api_tokens`, `user_secrets`.

---

## Testing

Everything below was actually run while building:

| Suite | Result | What it covers |
|---|---|---|
| `npm test` (vitest) | **56 / 56 pass** | Resume parsing on the real resume, experience calculation, scoring, filters, dedupe, salary/experience parsing, tailoring truth guard (fake AI responses with fabricated metrics, skills and bullets are rejected), PDF/DOCX export round-trip, letter/answer templates, all source adapters against fixtures, source failure isolation, full agent pipeline on the local DB, emergency stop, retries, form filler in **real Chrome** (Greenhouse-style and CAPTCHA forms), full worker flow (assisted fill → approval → submit → confirmation → "applied" with evidence), extension page scripts, and the unpacked extension loading in Chrome |
| `npm run test:e2e` | **70 / 70 pass** | Every API route against the production build in local mode, using the real resume: upload, profile edit, jobs, dedupe, filters, tailoring, export, letters, answers, prepare/routing, tracking, interviews, monitoring/notifications, hide/merge/unmerge, presets, sources, agent controls, dashboard, analytics, global search, extension bridge (token auth, CORS, capture, evidence rule, resume download), SSRF block, encrypted secrets, export/delete |
| `npm run test:db` | Pass | Migration applies cleanly on PostgreSQL 16; RLS blocks cross-user reads, inserts and updates; `user_secrets` is not readable by the authenticated role |
| `npm run typecheck`, `npm run lint`, `npm run build` | Clean | — |
| UI | Screenshots of every page in Chrome | No runtime page errors |

**Not tested here** (the build environment had no internet access and no Docker):

- live calls to the job APIs, Gemini/OpenAI, Telegram and Discord;
- real Supabase Auth, PostgREST and Storage (the schema and RLS were tested on Postgres; app logic was tested in local mode, which implements the same client API);
- real Greenhouse / Lever / Ashby pages (realistic local forms were used);
- the extension on real LinkedIn / Naukri pages, whose markup changes often.

---

## Known limitations & next steps

- **Unsupported or restricted integrations:**
  - LinkedIn, Naukri, Indeed, Glassdoor, Foundit, Wellfound, Instahyre, Hirist, Cutshort and FlexJobs are browser-assisted only. Automated scraping or applying would violate their terms.
  - FlexJobs needs a paid account.
  - The Indeed API is partner-only.
  - Workday applications need per-tenant accounts, so Workday is discovery-only.
- The auto-apply worker handles common Greenhouse, Lever and Ashby layouts. Custom questions it can't answer from verified data always go to your approval queue.
- Email notifications aren't included; Telegram and Discord are.
- Next steps:
  - verify each source live and add more Greenhouse/Lever/Ashby boards for companies hiring AI evaluators;
  - tune extension selectors on the job portals you use most;
  - add the remaining answer-library entries in Settings.
