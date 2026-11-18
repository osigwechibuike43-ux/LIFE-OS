-- Hosted Supabase projects grant EXECUTE on new functions to anon/authenticated by default, which the
-- earlier per-function REVOKEs did not fully undo. Make the intended surface explicit and minimal.

revoke execute on all functions in schema lifeos from public, anon, authenticated;
grant execute on function
  lifeos.complete_task(uuid), lifeos.complete_reminder(uuid), lifeos.get_entitlements(),
  lifeos.consume_ai_quota(), lifeos.ensure_profile(text), lifeos.erase_my_data(),
  -- pure helpers called by the SECURITY INVOKER complete_task / complete_reminder
  lifeos.next_occurrence(timestamptz, jsonb), lifeos.next_occurrence_after(timestamptz, jsonb, timestamptz)
  to authenticated;

-- RLS does not apply to TRUNCATE, REFERENCES or TRIGGER, so signed-in clients never get them.
revoke truncate, references, trigger on all tables in schema lifeos from authenticated;
revoke all on all tables in schema lifeos from anon;

alter function lifeos.set_updated_at() set search_path = '';

-- Future objects: do not hand out function execute implicitly.
alter default privileges in schema lifeos revoke execute on functions from authenticated;
