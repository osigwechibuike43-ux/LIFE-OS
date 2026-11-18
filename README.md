# LIFE OS

A personal operating system: tasks, reminders, calendar, daily planner, notes, private documents, long-term memory and an AI assistant that works with your real data and asks before it changes anything important.

> Your life, working together.

Stack: React 19 · TypeScript · Vite · Tailwind CSS · TanStack Query · Supabase (Auth, Postgres, Storage, Edge Functions, RLS) · Groq-compatible AI (Gemini/OpenAI ready) · PWA.

## What is in the box

| Area | What it does |
| --- | --- |
| Dashboard | Daily goals, real focus timer, completion rate, productivity rhythm, daily timeline, customizable widgets |
| AI assistant | Streaming chat with 13 tools over your tasks, reminders, notes, memory, schedule and insights. Reminder creation, task edits/completions and memory saves are shown as approval cards and only run after you confirm |
| Memory | Facts the assistant may use. Toggle off, export, delete. Secrets and sensitive data are refused |
| Tasks / Calendar / Planner | CRUD, priorities, categories, recurrence, month/week/day views, AI-drafted daily plan you approve |
| Notes / Documents | Rich-text notes with sanitised HTML and full-text search. PDF/DOCX/TXT/image uploads in a private bucket, opened via short-lived signed URLs |
| Automations | Rules with run history, executed by a scheduler (pg_cron or the `run-automations` function) |
| Insights | Computed from your own records only. Empty data shows empty states, never invented numbers |
| Settings | Profile, theme, notifications, AI provider, data export, account deletion, plan/entitlements |

Security model: Row Level Security on every table, owner-only policies, column-level grants (a user cannot edit their own plan), ownership triggers on cross-table references, AI keys only in Edge Function secrets, DOMPurify on rich text, private storage bucket.

## Quick start

```bash
npm install
cp .env.example .env.local     # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

Without Supabase variables the app shows a configuration screen instead of failing. Full backend setup: [docs/SETUP.md](docs/SETUP.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | 96 tests: real Postgres (PGlite) migration + RLS tests, tool/agent tests, validation, sanitisation, SSE parser, date logic, UI components |
| `npm run build` | Type-check + production build + service worker |

## Project layout

```
src/
  components/    ui kit, layout shell, search, notifications, assistant companion
  features/      auth, onboarding, dashboard, tasks, calendar, planner, notes,
                 documents, memory, assistant, automations, insights, settings
  hooks/ lib/ services/ types/
supabase/
  migrations/    schema, RLS, functions, storage, cron
  functions/     ai-agent, run-automations, send-push, delete-account, _shared
tests/           db (RLS/logic), shared (agent tools, insights), frontend
docs/SETUP.md    deployment guide
```

## Plans and billing

Free, Pro, Premium and Business exist as an entitlement model (`plans` table, `get_entitlements`, limits enforced in the database). **Billing is not implemented**: paid plans are shown as "Soon" and every user is on Free. Adding a payment provider means writing plan changes server-side with the service role; clients cannot change `plan_id`.

## Not implemented (by design, stated honestly)

- Payments / paid plan upgrades
- AI reading of uploaded documents (documents are stored and opened, not analysed)
- File attachments inside chat
- Native mobile apps (the PWA is installable)
- Team workspaces / sharing (Business plan is a placeholder)
- Email notifications (in-app and web push only)

## Needs your configuration before it works

- AI replies: set `GROQ_API_KEY` (or another provider key) as an Edge Function secret. Without it the assistant returns a clear "not configured" error.
- Google sign-in and email confirmation: configure in Supabase Auth.
- Web push: generate VAPID keys and set both the frontend public key and function secrets.
- Legal pages are drafts and must be reviewed by a lawyer before launch.

## Verification status

Verified here: migrations and RLS in a real Postgres engine, agent tools, typecheck, production build, and rendered screenshots of the dashboard, landing and assistant pages (desktop and mobile) against mocked API responses. **Not verified against a live Supabase project**; follow the checklist at the end of docs/SETUP.md after deploying.
