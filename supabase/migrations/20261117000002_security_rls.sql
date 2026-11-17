-- Row Level Security, privileges, ownership integrity, signup bootstrap.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS everywhere. Without a policy, access is denied.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'plans','profiles','user_preferences','ai_provider_settings','task_categories','note_categories',
    'tasks','reminders','calendar_events','notes','documents','memories','conversations','messages',
    'ai_pending_actions','daily_plans','automation_rules','automation_runs','notifications',
    'push_subscriptions','activity_logs','focus_sessions','rate_limits']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Privileges: anonymous users get nothing except the public plan list.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.plans to anon, authenticated;

-- rate_limits is only reachable through SECURITY DEFINER functions.
revoke all on public.rate_limits from authenticated;

-- Plans are read-only to clients.
revoke insert, update, delete on public.plans from authenticated;

-- Users may edit their profile but NEVER their plan (privilege escalation guard).
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name, avatar_url, primary_use_case, interests, timezone, onboarding_completed)
  on public.profiles to authenticated;

-- Notifications are created by the system; users can only mark read / delete.
revoke insert, update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Automation history and audit logs are append-only from the client's point of view.
revoke insert, update, delete on public.automation_runs from authenticated;
revoke update, delete on public.activity_logs from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies: a row is visible/writable only by its owner.
-- ---------------------------------------------------------------------------
create policy "plans are public" on public.plans for select to anon, authenticated using (true);

create policy "profiles select own" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'user_preferences','ai_provider_settings','task_categories','note_categories','tasks','reminders',
    'calendar_events','notes','documents','memories','conversations','messages','ai_pending_actions',
    'daily_plans','automation_rules','push_subscriptions','focus_sessions']
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || ' owner all', t);
  end loop;
end $$;

create policy "notifications select own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications update own" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications delete own" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "automation_runs select own" on public.automation_runs for select to authenticated
  using (user_id = (select auth.uid()));

create policy "activity select own" on public.activity_logs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "activity insert own" on public.activity_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Cross-table ownership integrity: a row may only reference rows owned by the same user.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_ref_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ref uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  owner uuid;
begin
  if ref is null then return new; end if;
  execute format('select user_id from public.%I where id = $1', tg_argv[1]) into owner using ref;
  if owner is distinct from new.user_id then
    raise exception 'Referenced % does not belong to this user', tg_argv[1] using errcode = '42501';
  end if;
  return new;
end $$;

create trigger tasks_ref_category before insert or update on public.tasks
  for each row execute function public.enforce_ref_owner('category_id', 'task_categories');
create trigger reminders_ref_task before insert or update on public.reminders
  for each row execute function public.enforce_ref_owner('task_id', 'tasks');
create trigger notes_ref_category before insert or update on public.notes
  for each row execute function public.enforce_ref_owner('category_id', 'note_categories');
create trigger messages_ref_conversation before insert or update on public.messages
  for each row execute function public.enforce_ref_owner('conversation_id', 'conversations');
create trigger focus_ref_task before insert or update on public.focus_sessions
  for each row execute function public.enforce_ref_owner('task_id', 'tasks');

-- ---------------------------------------------------------------------------
-- 5. Signup bootstrap: profile, preferences and default categories.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_categories(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_categories (user_id, name, color, is_default, sort_order) values
    (p_user, 'Personal',          '#817AFF', true, 1),
    (p_user, 'Education',         '#38BDF8', true, 2),
    (p_user, 'Work',              '#F5B544', true, 3),
    (p_user, 'Business',          '#34D399', true, 4),
    (p_user, 'Health & Fitness',  '#F472B6', true, 5),
    (p_user, 'Finance',           '#A3E635', true, 6),
    (p_user, 'Other',             '#94A3B8', true, 7)
  on conflict (user_id, name) do nothing;
  insert into public.note_categories (user_id, name, color, is_default, sort_order) values
    (p_user, 'Ideas',    '#F5B544', true, 1),
    (p_user, 'Journal',  '#817AFF', true, 2),
    (p_user, 'Work',     '#38BDF8', true, 3),
    (p_user, 'Study',    '#34D399', true, 4),
    (p_user, 'Personal', '#F472B6', true, 5)
  on conflict (user_id, name) do nothing;
end $$;
revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                                       new.raw_user_meta_data ->> 'name',
                                       split_part(coalesce(new.email, ''), '@', 1))), '');
begin
  insert into public.profiles (id, display_name, avatar_url)
    values (new.id, left(v_name, 80), new.raw_user_meta_data ->> 'avatar_url')
    on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.ai_provider_settings (user_id) values (new.id) on conflict do nothing;
  perform public.seed_default_categories(new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
