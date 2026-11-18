import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Boots an in-process Postgres, stubs the Supabase-managed pieces (auth schema, storage schema,
 * roles) and applies the real migrations from /supabase/migrations. This lets us run genuine
 * Row Level Security tests without a Supabase project.
 */
const STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select string_to_array(name, '/') $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

export async function createDb() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(STUBS);
  const dir = path.resolve(import.meta.dirname, '../../supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(dir, f), 'utf8'));
  }
  return db;
}

export async function createUser(db: PGlite, email: string, meta: Record<string, unknown> = {}) {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [email, JSON.stringify(meta)],
  );
  const id = res.rows[0].id;
  // Production provisions through lifeos.ensure_profile(); this is the same code path minus auth.uid().
  await db.query(`select lifeos.provision_user($1, $2, null, 'UTC', false)`, [id, (meta.full_name as string) ?? email.split('@')[0]]);
  return id;
}

/** Runs `fn` as an authenticated end user, with RLS enforced, then restores the superuser role. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}
