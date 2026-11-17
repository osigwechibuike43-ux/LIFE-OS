-- Business logic that must be atomic or run on a schedule: recurrence, quotas, reminders, automations.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.safe_tz(p_tz text)
returns text language plpgsql stable set search_path = '' as $$
begin
  perform now() at time zone coalesce(p_tz, 'UTC');
  return coalesce(p_tz, 'UTC');
exception when others then
  return 'UTC';
end $$;

-- Next occurrence of a recurrence rule after `base`. Returns null if the rule is invalid or past `until`.
create or replace function public.next_occurrence(base timestamptz, rec jsonb)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  n int := greatest(coalesce((rec ->> 'interval')::int, 1), 1);
  f text := rec ->> 'freq';
  r timestamptz;
begin
  if f = 'daily' then r := base + make_interval(days => n);
  elsif f = 'weekly' then r := base + make_interval(weeks => n);
  elsif f = 'monthly' then r := base + make_interval(months => n);
  elsif f = 'weekdays' then
    r := base + interval '1 day';
    while extract(isodow from r) > 5 loop r := r + interval '1 day'; end loop;
  else
    return null;
  end if;
  if rec ->> 'until' is not null and r > (rec ->> 'until')::timestamptz then
    return null;
  end if;
  return r;
end $$;

-- First occurrence strictly after `after_ts`, rolling forward over any missed ones.
create or replace function public.next_occurrence_after(base timestamptz, rec jsonb, after_ts timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare r timestamptz := base; guard int := 0;
begin
  loop
    r := public.next_occurrence(r, rec);
    exit when r is null or r > after_ts or guard > 2000;
    guard := guard + 1;
  end loop;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Tasks: completing a recurring task spawns the next occurrence in the same transaction.
-- SECURITY INVOKER: RLS still applies; auth.uid() is re-checked explicitly.
-- ---------------------------------------------------------------------------
create or replace function public.complete_task(p_task_id uuid)
returns public.tasks language plpgsql security invoker set search_path = '' as $$
declare
  t public.tasks;
  nxt timestamptz;
begin
  select * into t from public.tasks where id = p_task_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if t.status = 'done' then
    return t;
  end if;

  update public.tasks set status = 'done', completed_at = now()
    where id = t.id returning * into t;

  if t.recurrence is not null and t.due_at is not null then
    nxt := public.next_occurrence_after(t.due_at, t.recurrence, now());
    if nxt is not null then
      insert into public.tasks (user_id, category_id, title, description, priority, due_at, recurrence, source)
        values (t.user_id, t.category_id, t.title, t.description, t.priority, nxt, t.recurrence, t.source);
    end if;
  end if;

  insert into public.activity_logs (user_id, action, entity_type, entity_id)
    values (t.user_id, 'task.completed', 'task', t.id);
  return t;
end $$;

create or replace function public.complete_reminder(p_reminder_id uuid)
returns public.reminders language plpgsql security invoker set search_path = '' as $$
declare
  r public.reminders;
  nxt timestamptz;
begin
  select * into r from public.reminders where id = p_reminder_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'Reminder not found' using errcode = 'P0002';
  end if;
  if r.recurrence is not null then
    nxt := public.next_occurrence_after(r.remind_at, r.recurrence, now());
    if nxt is not null then
      update public.reminders set remind_at = nxt, notified_at = null, status = 'pending'
        where id = r.id returning * into r;
      return r;
    end if;
  end if;
  update public.reminders set status = 'done' where id = r.id returning * into r;
  insert into public.activity_logs (user_id, action, entity_type, entity_id)
    values (r.user_id, 'reminder.completed', 'reminder', r.id);
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Entitlements & quotas
-- ---------------------------------------------------------------------------
create or replace function public.get_entitlements()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('plan_id', p.plan_id, 'plan_name', pl.name, 'limits', pl.limits)
  from public.profiles p join public.plans pl on pl.id = p.plan_id
  where p.id = auth.uid();
$$;

create or replace function public.bump_rate_limit(p_user uuid, p_bucket text, p_window_seconds int)
returns int language plpgsql security definer set search_path = '' as $$
declare ws timestamptz; c int;
begin
  ws := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as rl (user_id, bucket, window_start, count)
    values (p_user, p_bucket, ws, 1)
    on conflict (user_id, bucket, window_start) do update set count = rl.count + 1
    returning rl.count into c;
  return c;
end $$;
revoke all on function public.bump_rate_limit(uuid, text, int) from public, anon, authenticated;

-- Atomically consumes one AI message. Burst limit first, then the plan's daily quota.
create or replace function public.consume_ai_quota()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  lim int;
  used int;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if public.bump_rate_limit(uid, 'ai_minute', 60) > 12 then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  end if;
  select coalesce((pl.limits ->> 'ai_messages_per_day')::int, 30) into lim
    from public.profiles p join public.plans pl on pl.id = p.plan_id where p.id = uid;
  used := public.bump_rate_limit(uid, 'ai_day', 86400);
  if used > coalesce(lim, 30) then
    return jsonb_build_object('allowed', false, 'reason', 'daily_limit', 'limit', lim);
  end if;
  return jsonb_build_object('allowed', true, 'remaining', greatest(coalesce(lim, 30) - used, 0), 'limit', lim);
end $$;

create or replace function public.cleanup_rate_limits()
returns void language sql security definer set search_path = '' as $$
  delete from public.rate_limits where window_start < now() - interval '2 days';
$$;
revoke all on function public.cleanup_rate_limits() from public, anon, authenticated;

-- Plan limits enforced in the database so they cannot be bypassed from a client.
create or replace function public.enforce_plan_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  lim int;
  cnt bigint;
begin
  select (pl.limits ->> tg_argv[0])::int into lim
    from public.profiles p join public.plans pl on pl.id = p.plan_id where p.id = new.user_id;
  if lim is null then return new; end if;
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into cnt using new.user_id;
  if cnt >= lim then
    raise exception 'Plan limit reached (% allowed). Upgrade to add more.', lim
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;

create trigger memories_plan_limit before insert on public.memories
  for each row execute function public.enforce_plan_limit('memories');
create trigger documents_plan_limit before insert on public.documents
  for each row execute function public.enforce_plan_limit('documents');
create trigger automations_plan_limit before insert on public.automation_rules
  for each row execute function public.enforce_plan_limit('automations');

-- ---------------------------------------------------------------------------
-- Notifications helper (respects the in-app notification preference)
-- ---------------------------------------------------------------------------
create or replace function public.notify_user(
  p_user uuid, p_type text, p_title text, p_body text, p_link text, p_ref uuid, p_dedupe text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare allowed boolean; n int;
begin
  select coalesce(up.notifications_in_app, true) into allowed
    from public.user_preferences up where up.user_id = p_user;
  if coalesce(allowed, true) = false then return false; end if;
  insert into public.notifications (user_id, type, title, body, link, reference_id, dedupe_key)
    values (p_user, p_type, left(p_title, 300), left(p_body, 2000), p_link, p_ref, p_dedupe)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.notify_user(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reminders: called every minute by pg_cron (or by the run-automations Edge Function).
-- ---------------------------------------------------------------------------
create or replace function public.process_due_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  nxt timestamptz;
  cnt int := 0;
begin
  for r in
    select * from public.reminders
    where status = 'pending' and notified_at is null and remind_at <= now()
    order by remind_at limit 500
    for update skip locked
  loop
    perform public.notify_user(r.user_id, 'reminder', r.title, r.description, '/app/tasks?tab=reminders', r.id,
      'reminder:' || r.id || ':' || extract(epoch from r.remind_at)::bigint);
    cnt := cnt + 1;
    nxt := null;
    if r.recurrence is not null then
      nxt := public.next_occurrence_after(r.remind_at, r.recurrence, now());
    end if;
    if nxt is not null then
      update public.reminders set remind_at = nxt, notified_at = null where id = r.id;
    else
      update public.reminders set notified_at = now() where id = r.id;
    end if;
  end loop;
  return cnt;
end $$;
revoke all on function public.process_due_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Automations: Trigger -> Conditions -> Action, with execution history.
-- ---------------------------------------------------------------------------
create or replace function public.compute_next_run(p_type text, p_cfg jsonb, p_tz text, p_after timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  tz text := public.safe_tz(p_tz);
  t time := coalesce(nullif(p_cfg ->> 'time', ''), '08:00')::time;
  local_now timestamp := p_after at time zone tz;
  cand timestamp;
  wd int;
begin
  cand := date_trunc('day', local_now) + t;
  if p_type in ('daily', 'before_deadline') then
    if cand <= local_now then cand := cand + interval '1 day'; end if;
  elsif p_type = 'weekly' then
    wd := coalesce((p_cfg ->> 'weekday')::int, 1);
    cand := cand + make_interval(days => ((wd - extract(isodow from cand)::int + 7) % 7));
    if cand <= local_now then cand := cand + interval '7 days'; end if;
  else
    return null;
  end if;
  return cand at time zone tz;
end $$;

create or replace function public.automation_set_next_run()
returns trigger language plpgsql security definer set search_path = '' as $$
declare tz text;
begin
  select p.timezone into tz from public.profiles p where p.id = new.user_id;
  if new.is_active then
    new.next_run_at := public.compute_next_run(new.trigger_type, new.trigger_config, tz, now());
  else
    new.next_run_at := null;
  end if;
  return new;
end $$;

create trigger automation_next_run
  before insert or update of trigger_type, trigger_config, is_active on public.automation_rules
  for each row execute function public.automation_set_next_run();

create or replace function public.execute_automation_action(r public.automation_rules, p_tz text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tz text := public.safe_tz(p_tz);
  local_today date := (now() at time zone tz)::date;
  day_end timestamptz := ((local_today + 1)::timestamp) at time zone tz;
  items jsonb;
  done_n int; open_n int; overdue_n int; focus_min int; n int := 0;
  days int; tk record; sent boolean;
begin
  if r.action_type = 'notify' then
    sent := public.notify_user(r.user_id, 'automation', coalesce(nullif(r.action_config ->> 'title', ''), r.name),
      r.action_config ->> 'body', '/app', r.id, 'auto:' || r.id || ':' || extract(epoch from now())::bigint);
    return jsonb_build_object('notified', sent);

  elsif r.action_type = 'weekly_summary' then
    select count(*) filter (where status = 'done' and completed_at >= now() - interval '7 days'),
           count(*) filter (where status <> 'done'),
           count(*) filter (where status <> 'done' and due_at < now())
      into done_n, open_n, overdue_n from public.tasks where user_id = r.user_id;
    select coalesce(sum(duration_seconds) / 60, 0)::int into focus_min
      from public.focus_sessions where user_id = r.user_id and started_at >= now() - interval '7 days';
    sent := public.notify_user(r.user_id, 'automation', 'Your weekly summary',
      format('Completed %s tasks this week. %s still open (%s overdue). Focus time: %s min.',
             done_n, open_n, overdue_n, focus_min),
      '/app/insights', r.id, 'auto:' || r.id || ':' || extract(epoch from now())::bigint);
    return jsonb_build_object('completed', done_n, 'open', open_n, 'overdue', overdue_n, 'focus_minutes', focus_min);

  elsif r.action_type = 'daily_plan' then
    if exists (select 1 from public.daily_plans where user_id = r.user_id and plan_date = local_today) then
      return jsonb_build_object('skipped', 'A plan for today already exists');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', gen_random_uuid(), 'title', x.title, 'start', null, 'end', null,
             'kind', 'task', 'ref_id', x.id, 'done', false) order by x.rank, x.due_at nulls last), '[]'::jsonb)
      into items
      from (select t.id, t.title, t.due_at,
                   case t.priority when 'high' then 1 when 'medium' then 2 else 3 end as rank
            from public.tasks t
            where t.user_id = r.user_id and t.status <> 'done' and t.due_at is not null and t.due_at < day_end
            order by 4, t.due_at limit 8) x;
    if jsonb_array_length(items) = 0 then
      return jsonb_build_object('skipped', 'Nothing due today');
    end if;
    insert into public.daily_plans (user_id, plan_date, status, summary, items, source)
      values (r.user_id, local_today, 'proposed',
              format('%s tasks lined up for today, highest priority first.', jsonb_array_length(items)),
              items, 'automation');
    perform public.notify_user(r.user_id, 'automation', 'Your daily plan is ready to review',
      format('%s tasks are lined up for today.', jsonb_array_length(items)), '/app/planner', r.id,
      'auto:' || r.id || ':' || local_today);
    return jsonb_build_object('plan_items', jsonb_array_length(items));

  elsif r.action_type = 'deadline_alert' then
    days := greatest(coalesce((r.trigger_config ->> 'days_before')::int, 3), 1);
    for tk in
      select t.id, t.title, t.due_at from public.tasks t
      where t.user_id = r.user_id and t.status <> 'done' and t.due_at > now()
        and t.due_at <= now() + make_interval(days => days)
        and (coalesce(r.action_config ->> 'priority', 'any') = 'any' or t.priority = 'high')
    loop
      sent := public.notify_user(r.user_id, 'deadline', 'Deadline approaching: ' || tk.title,
        'Due ' || to_char(tk.due_at at time zone tz, 'Dy DD Mon, HH24:MI'), '/app/tasks', tk.id,
        'deadline:' || tk.id || ':' || days);
      if sent then n := n + 1; end if;
    end loop;
    return jsonb_build_object('alerts_created', n);
  end if;

  return jsonb_build_object('skipped', 'Unknown action');
end $$;
revoke all on function public.execute_automation_action(public.automation_rules, text) from public, anon, authenticated;

create or replace function public.run_automations()
returns int language plpgsql security definer set search_path = '' as $$
declare
  r public.automation_rules;
  tz text;
  res jsonb;
  started timestamptz;
  n int := 0;
begin
  for r in
    select * from public.automation_rules
    where is_active and next_run_at is not null and next_run_at <= now()
    order by next_run_at limit 200
    for update skip locked
  loop
    started := clock_timestamp();
    select public.safe_tz(p.timezone) into tz from public.profiles p where p.id = r.user_id;
    begin
      if coalesce((r.conditions ->> 'weekdays_only')::boolean, false)
         and extract(isodow from (now() at time zone tz)) > 5 then
        insert into public.automation_runs (rule_id, user_id, status, started_at, finished_at, result)
          values (r.id, r.user_id, 'skipped', started, clock_timestamp(), '{"reason":"weekend"}');
      elsif coalesce((r.conditions ->> 'only_if_open_tasks')::boolean, false)
         and not exists (select 1 from public.tasks where user_id = r.user_id and status <> 'done') then
        insert into public.automation_runs (rule_id, user_id, status, started_at, finished_at, result)
          values (r.id, r.user_id, 'skipped', started, clock_timestamp(), '{"reason":"no open tasks"}');
      else
        res := public.execute_automation_action(r, tz);
        insert into public.automation_runs (rule_id, user_id, status, started_at, finished_at, result)
          values (r.id, r.user_id, case when res ? 'skipped' then 'skipped' else 'success' end,
                  started, clock_timestamp(), res);
      end if;
    exception when others then
      insert into public.automation_runs (rule_id, user_id, status, started_at, finished_at, error)
        values (r.id, r.user_id, 'failed', started, clock_timestamp(), left(sqlerrm, 500));
    end;
    update public.automation_rules
      set last_run_at = now(), next_run_at = public.compute_next_run(r.trigger_type, r.trigger_config, tz, now())
      where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.run_automations() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client-callable RPC grants
-- ---------------------------------------------------------------------------
revoke all on function public.complete_task(uuid) from public, anon;
revoke all on function public.complete_reminder(uuid) from public, anon;
revoke all on function public.get_entitlements() from public, anon;
revoke all on function public.consume_ai_quota() from public, anon;
grant execute on function public.complete_task(uuid) to authenticated;
grant execute on function public.complete_reminder(uuid) to authenticated;
grant execute on function public.get_entitlements() to authenticated;
grant execute on function public.consume_ai_quota() to authenticated;
