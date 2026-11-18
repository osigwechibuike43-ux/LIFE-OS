-- LIFE OS core schema
-- All personal tables carry user_id -> auth.users(id) ON DELETE CASCADE, so deleting
-- an auth user removes every personal record (supports account deletion / NDPA erasure).

-- LIFE OS lives in its own schema so it can share a Supabase project with other apps without
-- touching their tables. The schema must also be listed under Settings > API > Exposed schemas.
create schema if not exists lifeos;
grant usage on schema lifeos to authenticated, service_role;
alter default privileges in schema lifeos grant all on tables to authenticated, service_role;
alter default privileges in schema lifeos grant all on sequences to authenticated, service_role;
alter default privileges in schema lifeos grant execute on functions to authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function lifeos.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Plans / entitlements (no payments yet: plan_id simply gates limits)
-- ---------------------------------------------------------------------------
create table lifeos.plans (
  id text primary key,
  name text not null,
  description text,
  limits jsonb not null default '{}'::jsonb,
  sort_order int not null default 0
);

insert into lifeos.plans (id, name, description, limits, sort_order) values
  ('free', 'Free', 'Personal dashboard, tasks, notes, basic reminders, limited AI',
    '{"ai_messages_per_day":30,"memories":200,"documents":50,"storage_mb":100,"automations":3}', 1),
  ('pro', 'Pro', 'Advanced assistant, expanded memory, more automation',
    '{"ai_messages_per_day":150,"memories":2000,"documents":500,"storage_mb":2048,"automations":20}', 2),
  ('premium', 'Premium', 'Higher AI usage, advanced automation, extended storage',
    '{"ai_messages_per_day":600,"memories":10000,"documents":5000,"storage_mb":10240,"automations":100}', 3),
  ('business', 'Business', 'Shared workspaces and team tools (planned)',
    '{"ai_messages_per_day":1000,"memories":50000,"documents":20000,"storage_mb":51200,"automations":500}', 4);

-- ---------------------------------------------------------------------------
-- Profiles & preferences
-- ---------------------------------------------------------------------------
create table lifeos.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  avatar_url text,
  primary_use_case text check (primary_use_case in
    ('student','professional','entrepreneur','business_owner','freelancer','family','personal')),
  interests text[] not null default '{}',
  timezone text not null default 'UTC',
  onboarding_completed boolean not null default false,
  plan_id text not null default 'free' references lifeos.plans(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lifeos.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light','dark','system')),
  notifications_in_app boolean not null default true,
  notifications_push boolean not null default false,
  notifications_email boolean not null default false,
  memory_enabled boolean not null default true,
  ai_can_save_memory boolean not null default true,
  ai_enabled boolean not null default true,
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  dashboard_widgets jsonb not null default
    '{"focus":true,"completion":true,"rhythm":true,"timeline":true,"notes":true,"reminders":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Provider/model choice only. API keys NEVER live in the database or the browser.
create table lifeos.ai_provider_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'default' check (provider in ('default','groq','gemini','openai')),
  model text check (char_length(model) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table lifeos.task_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#817AFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table lifeos.note_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#817AFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------
-- Tasks, reminders, events
-- ---------------------------------------------------------------------------
create table lifeos.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references lifeos.task_categories(id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 5000),
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  due_at timestamptz,
  recurrence jsonb check (
    recurrence is null or (
      recurrence->>'freq' in ('daily','weekdays','weekly','monthly')
      and coalesce((recurrence->>'interval')::int, 1) between 1 and 365)),
  completed_at timestamptz,
  source text not null default 'manual' check (source in ('manual','ai','automation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_user_status_due_idx on lifeos.tasks (user_id, status, due_at);
create index tasks_user_completed_idx on lifeos.tasks (user_id, completed_at) where completed_at is not null;
create index tasks_user_category_idx on lifeos.tasks (user_id, category_id);
create index tasks_title_trgm_idx on lifeos.tasks using gin (title extensions.gin_trgm_ops);

create table lifeos.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references lifeos.tasks(id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 2000),
  remind_at timestamptz not null,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  recurrence jsonb check (
    recurrence is null or (
      recurrence->>'freq' in ('daily','weekdays','weekly','monthly')
      and coalesce((recurrence->>'interval')::int, 1) between 1 and 365)),
  status text not null default 'pending' check (status in ('pending','done','dismissed')),
  notified_at timestamptz,
  source text not null default 'manual' check (source in ('manual','ai','automation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminders_due_idx on lifeos.reminders (remind_at) where status = 'pending' and notified_at is null;
create index reminders_user_idx on lifeos.reminders (user_id, status, remind_at);

create table lifeos.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text check (char_length(description) <= 5000),
  location text check (char_length(location) <= 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  color text not null default '#817AFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create index events_user_start_idx on lifeos.calendar_events (user_id, starts_at);

-- ---------------------------------------------------------------------------
-- Notes, documents, memories
-- ---------------------------------------------------------------------------
create table lifeos.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references lifeos.note_categories(id) on delete set null,
  title text not null default '' check (char_length(title) <= 300),
  content text not null default '' check (char_length(content) <= 200000),   -- sanitized HTML
  content_text text not null default '' check (char_length(content_text) <= 100000), -- plain text for search/AI
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  is_favorite boolean not null default false,
  source text not null default 'manual' check (source in ('manual','ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector
);

create or replace function lifeos.notes_update_search()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.search := to_tsvector('simple',
    coalesce(new.title, '') || ' ' || coalesce(new.content_text, '') || ' ' || coalesce(array_to_string(new.tags, ' '), ''));
  return new;
end $$;
create trigger notes_search_trg before insert or update of title, content_text, tags on lifeos.notes
  for each row execute function lifeos.notes_update_search();
create index notes_user_updated_idx on lifeos.notes (user_id, updated_at desc);
create index notes_search_idx on lifeos.notes using gin (search);
create index notes_tags_idx on lifeos.notes using gin (tags);

create table lifeos.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  category text not null default 'general' check (category in
    ('general','identity','education','work','finance','health','legal','other')),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_user_idx on lifeos.documents (user_id, created_at desc);
create index documents_name_trgm_idx on lifeos.documents using gin (name extensions.gin_trgm_ops);

create table lifeos.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'user_created' check (category in
    ('preferences','important_info','goals','work_education','projects','important_dates','user_created')),
  content text not null check (char_length(content) between 1 and 2000),
  -- 'user' = typed by the user; 'ai_confirmed' = proposed by the assistant AND approved by the user.
  source text not null default 'user' check (source in ('user','ai_confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user_idx on lifeos.memories (user_id, category, created_at desc);
create index memories_content_trgm_idx on lifeos.memories using gin (content extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Assistant
-- ---------------------------------------------------------------------------
create table lifeos.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on lifeos.conversations (user_id, updated_at desc);

create table lifeos.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references lifeos.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content text not null default '' check (char_length(content) <= 32000),
  tool_calls jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_conv_idx on lifeos.messages (conversation_id, created_at);

-- Actions the assistant proposed that need the user's explicit approval before running.
create table lifeos.ai_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references lifeos.conversations(id) on delete cascade,
  tool text not null,
  args jsonb not null,
  summary text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  resolved_at timestamptz
);
create index ai_pending_user_idx on lifeos.ai_pending_actions (user_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Planner, automations, notifications, logs
-- ---------------------------------------------------------------------------
create table lifeos.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  status text not null default 'proposed' check (status in ('proposed','approved')),
  summary text check (char_length(summary) <= 2000),
  -- [{ "id": uuid, "title": text, "start": "HH:MM"|null, "end": "HH:MM"|null, "kind": "task|reminder|event|focus|break", "ref_id": uuid|null, "done": bool }]
  items jsonb not null default '[]'::jsonb,
  source text not null default 'manual' check (source in ('manual','ai','automation')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

create table lifeos.automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 500),
  trigger_type text not null check (trigger_type in ('daily','weekly','before_deadline')),
  trigger_config jsonb not null default '{}'::jsonb,   -- {time:"08:00", weekday:1 (1=Mon..7=Sun), days_before:3}
  conditions jsonb not null default '{}'::jsonb,       -- {weekdays_only:bool, only_if_open_tasks:bool}
  action_type text not null check (action_type in ('notify','weekly_summary','daily_plan','deadline_alert')),
  action_config jsonb not null default '{}'::jsonb,    -- {title, body}
  is_active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index automation_due_idx on lifeos.automation_rules (next_run_at) where is_active;
create index automation_user_idx on lifeos.automation_rules (user_id);

create table lifeos.automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references lifeos.automation_rules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('success','skipped','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb,
  error text
);
create index automation_runs_idx on lifeos.automation_runs (user_id, started_at desc);
create index automation_runs_rule_idx on lifeos.automation_runs (rule_id, started_at desc);

create table lifeos.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('reminder','automation','system','deadline')),
  title text not null check (char_length(title) <= 300),
  body text check (char_length(body) <= 2000),
  link text,
  reference_id uuid,
  dedupe_key text,
  read_at timestamptz,
  push_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe_idx on lifeos.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on lifeos.notifications (user_id, created_at desc);
create index notifications_unread_idx on lifeos.notifications (user_id) where read_at is null;
create index notifications_push_idx on lifeos.notifications (created_at) where push_sent_at is null;

create table lifeos.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_user_idx on lifeos.push_subscriptions (user_id);

-- Audit trail. AI tool executions are recorded with source = 'ai'. Never store secrets or document contents here.
create table lifeos.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(action) <= 100),
  entity_type text check (char_length(entity_type) <= 60),
  entity_id uuid,
  source text not null default 'user' check (source in ('user','ai','automation','system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_user_idx on lifeos.activity_logs (user_id, created_at desc);

create table lifeos.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references lifeos.tasks(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int not null default 0 check (duration_seconds >= 0 and duration_seconds <= 86400),
  created_at timestamptz not null default now()
);
create index focus_user_idx on lifeos.focus_sessions (user_id, started_at desc);

create table lifeos.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, bucket, window_start)
);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['profiles','user_preferences','ai_provider_settings','tasks','reminders',
    'calendar_events','notes','documents','memories','conversations','daily_plans','automation_rules']
  loop
    execute format('create trigger %I before update on lifeos.%I for each row execute function lifeos.set_updated_at()',
      t || '_updated_at', t);
  end loop;
end $$;
