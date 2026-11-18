-- Private document storage + scheduled jobs.

-- ---------------------------------------------------------------------------
-- Storage: private 'lifeos-documents' bucket. Objects live at <user_id>/<uuid>-<filename>.
-- No public access; policies restrict every operation to the owner's folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lifeos-documents', 'lifeos-documents', false, 26214400,
  array['application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "lifeos documents read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'lifeos-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "lifeos documents upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'lifeos-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "lifeos documents update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'lifeos-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "lifeos documents delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'lifeos-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Scheduling with pg_cron (available on Supabase; enable it in Database > Extensions if this block notices it is missing).
-- Fallback: call the `run-automations` Edge Function every minute from any scheduler.
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('lifeos-tick', '* * * * *',
    $job$ select lifeos.process_due_reminders(); select lifeos.run_automations(); $job$);
  perform cron.schedule('lifeos-cleanup', '17 * * * *', $job$ select lifeos.cleanup_rate_limits(); $job$);
exception when others then
  raise notice 'pg_cron not enabled (%). Use the run-automations Edge Function as the scheduler.', sqlerrm;
end $$;
