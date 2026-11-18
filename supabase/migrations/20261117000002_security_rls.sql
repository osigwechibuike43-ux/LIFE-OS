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
    execute format('alter table lifeos.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Privileges: anonymous users get nothing except the public plan list.
-- ---------------------------------------------------------------------------
grant select on lifeos.plans to authenticated;

-- rate_limits is only reachable through SECURITY DEFINER functions.
revoke all on lifeos.rate_limits from authenticated;

-- Plans are read-only to clients.
revoke insert, update, delete on lifeos.plans from authenticated;

-- Users may edit their profile but NEVER their plan (privilege escalation guard).
revoke insert, update, delete on lifeos.profiles from authenticated;
grant update (display_name, avatar_url, primary_use_case, interests, timezone, onboarding_completed)
  on lifeos.profiles to authenticated;

-- Notifications are created by the system; users can only mark read / delete.
revoke insert, update on lifeos.notifications from authenticated;
grant update (read_at) on lifeos.notifications to authenticated;

-- Automation history and audit logs are append-only from the client's point of view.
revoke insert, update, delete on lifeos.automation_runs from authenticated;
revoke update, delete on lifeos.activity_logs from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies: a row is visible/writable only by its owner.
-- ---------------------------------------------------------------------------
create policy "plans are public" on lifeos.plans for select to anon, authenticated using (true);

create policy "profiles select own" on lifeos.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles update own" on lifeos.profiles for update to authenticated
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
      'create policy %I on lifeos.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || ' owner all', t);
  end loop;
end $$;

create policy "notifications select own" on lifeos.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications update own" on lifeos.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications delete own" on lifeos.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "automation_runs select own" on lifeos.automation_runs for select to authenticated
  using (user_id = (select auth.uid()));

create policy "activity select own" on lifeos.activity_logs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "activity insert own" on lifeos.activity_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Cross-table ownership integrity: a row may only reference rows owned by the same user.
-- ---------------------------------------------------------------------------
create or replace function lifeos.enforce_ref_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ref uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  owner uuid;
begin
  if ref is null then return new; end if;
  execute format('select user_id from lifeos.%I where id = $1', tg_argv[1]) into owner using ref;
  if owner is distinct from new.user_id then
    raise exception 'Referenced % does not belong to this user', tg_argv[1] using errcode = '42501';
  end if;
  return new;
end $$;

create trigger tasks_ref_category before insert or update on lifeos.tasks
  for each row execute function lifeos.enforce_ref_owner('category_id', 'task_categories');
create trigger reminders_ref_task before insert or update on lifeos.reminders
  for each row execute function lifeos.enforce_ref_owner('task_id', 'tasks');
create trigger notes_ref_category before insert or update on lifeos.notes
  for each row execute function lifeos.enforce_ref_owner('category_id', 'note_categories');
create trigger messages_ref_conversation before insert or update on lifeos.messages
  for each row execute function lifeos.enforce_ref_owner('conversation_id', 'conversations');
create trigger focus_ref_task before insert or update on lifeos.focus_sessions
  for each row execute function lifeos.enforce_ref_owner('task_id', 'tasks');

-- ---------------------------------------------------------------------------
-- 5. Signup bootstrap: profile, preferences and default categories.
-- ---------------------------------------------------------------------------
create or replace function lifeos.seed_default_categories(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into lifeos.task_categories (user_id, name, color, is_default, sort_order) values
    (p_user, 'Personal',          '#817AFF', true, 1),
    (p_user, 'Education',         '#38BDF8', true, 2),
    (p_user, 'Work',              '#F5B544', true, 3),
    (p_user, 'Business',          '#34D399', true, 4),
    (p_user, 'Health & Fitness',  '#F472B6', true, 5),
    (p_user, 'Finance',           '#A3E635', true, 6),
    (p_user, 'Other',             '#94A3B8', true, 7)
  on conflict (user_id, name) do nothing;
  insert into lifeos.note_categories (user_id, name, color, is_default, sort_order) values
    (p_user, 'Ideas',    '#F5B544', true, 1),
    (p_user, 'Journal',  '#817AFF', true, 2),
    (p_user, 'Work',     '#38BDF8', true, 3),
    (p_user, 'Study',    '#34D399', true, 4),
    (p_user, 'Personal', '#F472B6', true, 5)
  on conflict (user_id, name) do nothing;
end $$;
revoke all on function lifeos.seed_default_categories(uuid) from public, anon, authenticated;

-- No trigger on auth.users: that table is shared with other apps, so LIFE OS must not run code on
-- their sign-ups. Instead the client calls lifeos.ensure_profile() after sign-in; it is idempotent.
create or replace function lifeos.provision_user(p_user uuid, p_name text, p_avatar text, p_timezone text, p_skip_onboarding boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := case when exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then p_timezone else 'UTC' end;
begin
  insert into lifeos.profiles (id, display_name, avatar_url, timezone, onboarding_completed)
    values (p_user, left(nullif(btrim(p_name), ''), 80), p_avatar, v_tz, coalesce(p_skip_onboarding, false))
    on conflict (id) do nothing;
  insert into lifeos.user_preferences (user_id) values (p_user) on conflict do nothing;
  insert into lifeos.ai_provider_settings (user_id) values (p_user) on conflict do nothing;
  perform lifeos.seed_default_categories(p_user);
end $$;
revoke all on function lifeos.provision_user(uuid, text, text, text, boolean) from public, anon, authenticated;

-- Called by the signed-in user. Google (OAuth) users skip onboarding and land on the dashboard.
create or replace function lifeos.ensure_profile(p_timezone text default null)
returns lifeos.profiles language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_user record;
  v_oauth boolean;
  v_row lifeos.profiles;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select id, email, raw_user_meta_data, raw_app_meta_data into v_user from auth.users where id = v_uid;
  if not found then raise exception 'User not found' using errcode = '28000'; end if;
  v_oauth := coalesce(v_user.raw_app_meta_data ->> 'provider', 'email') <> 'email';
  perform lifeos.provision_user(
    v_uid,
    coalesce(v_user.raw_user_meta_data ->> 'full_name', v_user.raw_user_meta_data ->> 'name', split_part(coalesce(v_user.email, ''), '@', 1)),
    coalesce(v_user.raw_user_meta_data ->> 'avatar_url', v_user.raw_user_meta_data ->> 'picture'),
    p_timezone,
    v_oauth);
  select * into v_row from lifeos.profiles where id = v_uid;
  return v_row;
end $$;
revoke all on function lifeos.ensure_profile(text) from public, anon;
grant execute on function lifeos.ensure_profile(text) to authenticated;

-- Erases only LIFE OS data for the caller. The auth user is shared with other apps and is never deleted here.
create or replace function lifeos.erase_my_data()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  t text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  foreach t in array array[
    'automation_runs','automation_rules','ai_pending_actions','messages','conversations','notifications',
    'push_subscriptions','activity_logs','focus_sessions','daily_plans','memories','documents','notes',
    'reminders','calendar_events','tasks','task_categories','note_categories','rate_limits',
    'ai_provider_settings','user_preferences']
  loop
    execute format('delete from lifeos.%I where user_id = $1', t) using v_uid;
  end loop;
  delete from lifeos.profiles where id = v_uid;
end $$;
revoke all on function lifeos.erase_my_data() from public, anon;
grant execute on function lifeos.erase_my_data() to authenticated;
