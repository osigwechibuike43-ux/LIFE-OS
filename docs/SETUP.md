# Setup and deployment

## 1. Create the Supabase project
1. Create a project at supabase.com. Note the project ref, API URL and anon/publishable key.
2. Apply migrations in order (`supabase/migrations/*.sql`):
   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref YOUR_REF
   supabase db push
   ```
3. Database → Extensions: enable `pg_cron` and `pg_trgm` if migration notices say they are missing.

## 2. Auth
- Authentication → URL Configuration: set Site URL to your deployed origin and add `http://localhost:5173` and `https://YOUR_DOMAIN/**` to redirect URLs (password reset and OAuth return there).
- Email: keep "Confirm email" on for production; configure custom SMTP (the default sender is rate limited).
- Google: Authentication → Providers → Google; add client ID/secret from Google Cloud Console and the Supabase callback URL as an authorised redirect.

## 3. Edge Functions and secrets
```bash
cp supabase/functions/.env.example supabase/functions/.env   # fill values, never commit
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy ai-agent
supabase functions deploy run-automations --no-verify-jwt
supabase functions deploy send-push --no-verify-jwt
supabase functions deploy delete-account
```
Secrets: `GROQ_API_KEY` (+ optional `GEMINI_API_KEY`, `OPENAI_API_KEY`), `AI_DEFAULT_PROVIDER`, `CRON_SECRET`, `VAPID_*` (optional), `ALLOWED_ORIGINS` (set to your production origin, not `*`).
`run-automations` and `send-push` are authenticated by `CRON_SECRET` (not a user JWT), which is why they are deployed with `--no-verify-jwt`.

## 4. Scheduler
Reminders and automations need a one-minute tick.
- **pg_cron (preferred):** migration `0004` schedules `lifeos-tick` when the extension is available.
- **Fallback:** call the function every minute from any scheduler (GitHub Actions, cron-job.org):
  `curl -X POST https://YOUR_REF.supabase.co/functions/v1/run-automations -H "Authorization: Bearer $CRON_SECRET"`
  If you use web push, call `/functions/v1/send-push` the same way every minute (pg_cron does not trigger it).

## 5. Web push (optional)
`npx web-push generate-vapid-keys` → public key to `VITE_VAPID_PUBLIC_KEY` and `VAPID_PUBLIC_KEY`, private key to `VAPID_PRIVATE_KEY`, set `VAPID_SUBJECT`. Without it, push is hidden and in-app notifications still work.

## 6. Deploy the frontend (Vercel)
1. Import the GitHub repo. Framework: Vite. `vercel.json` already sets SPA rewrites, security headers and caching.
2. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_VAPID_PUBLIC_KEY`.
3. Deploy, then put the production URL into Supabase Site URL and `ALLOWED_ORIGINS`.

## 7. Post-deploy checklist
- [ ] Sign up, confirm email, finish onboarding
- [ ] Create task, reminder, event, note; refresh and confirm persistence
- [ ] Second account cannot see the first account's data
- [ ] Upload a PDF; open it; confirm the bucket is private
- [ ] Assistant answers; "remind me tomorrow at 10" shows an approval card and creates nothing until approved
- [ ] A due reminder produces an in-app notification within ~1 minute
- [ ] Export data; delete a test account
- [ ] Install the PWA; confirm API traffic is not cached
- [ ] Run Supabase Advisors (security and performance) and resolve warnings

## Assumptions
- Email/password is the primary login; Google needs your credentials.
- All users start on Free; limits come from the `plans` table.
- Timezone is stored per profile and used for reminders, plans and insights.
- Legal text is a draft template.
