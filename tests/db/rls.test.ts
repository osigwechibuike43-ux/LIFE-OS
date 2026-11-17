// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, createDb, createUser } from './harness';

let db: PGlite;
let alice: string;
let bob: string;
let aliceTask: string;

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow();
}

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
  aliceTask = await asUser(db, alice, async () => {
    const r = await db.query<{ id: string }>(
      `insert into public.tasks (user_id, title) values ($1, 'Alice private task') returning id`, [alice]);
    await db.query(`insert into public.memories (user_id, content) values ($1, 'Alice likes mornings')`, [alice]);
    await db.query(`insert into public.notes (user_id, title, content_text) values ($1, 'Secret', 'diary')`, [alice]);
    return r.rows[0].id;
  });
}, 60_000);

describe('RLS: data isolation between users', () => {
  const tables = ['tasks', 'memories', 'notes', 'task_categories', 'user_preferences', 'profiles'];

  it.each(tables)('bob cannot read alice rows in %s', async (table) => {
    const col = table === 'profiles' ? 'id' : 'user_id';
    const rows = await asUser(db, bob, () =>
      db.query(`select * from public.${table} where ${col} = $1`, [alice]));
    expect(rows.rows).toHaveLength(0);
  });

  it('alice can read her own rows', async () => {
    const rows = await asUser(db, alice, () => db.query('select * from public.tasks'));
    expect(rows.rows).toHaveLength(1);
  });

  it('bob cannot update or delete alice task (no rows affected)', async () => {
    const upd = await asUser(db, bob, () =>
      db.query(`update public.tasks set title = 'pwned' where id = $1`, [aliceTask]));
    expect(upd.affectedRows).toBe(0);
    const del = await asUser(db, bob, () =>
      db.query(`delete from public.tasks where id = $1`, [aliceTask]));
    expect(del.affectedRows).toBe(0);
    const still = await db.query<{ title: string }>('select title from public.tasks where id = $1', [aliceTask]);
    expect(still.rows[0].title).toBe('Alice private task');
  });

  it('bob cannot insert a row owned by alice', async () => {
    await expectDenied(asUser(db, bob, () =>
      db.query(`insert into public.tasks (user_id, title) values ($1, 'forged')`, [alice])));
  });

  it('bob cannot reassign his row to alice via update', async () => {
    const t = await asUser(db, bob, async () => (await db.query<{ id: string }>(
      `insert into public.tasks (user_id, title) values ($1, 'bob task') returning id`, [bob])).rows[0].id);
    await expectDenied(asUser(db, bob, () =>
      db.query(`update public.tasks set user_id = $1 where id = $2`, [alice, t])));
  });

  it('anonymous users see nothing but the public plan list', async () => {
    await expectDenied(asAnon(db, () => db.query('select * from public.tasks')));
    const plans = await asAnon(db, () => db.query('select id from public.plans'));
    expect(plans.rows.length).toBeGreaterThan(0);
  });

  it('a user cannot reference another user category on a task', async () => {
    const aliceCat = (await db.query<{ id: string }>(
      'select id from public.task_categories where user_id = $1 limit 1', [alice])).rows[0].id;
    await expectDenied(asUser(db, bob, () =>
      db.query(`insert into public.tasks (user_id, title, category_id) values ($1, 'x', $2)`, [bob, aliceCat])));
  });

  it('a user cannot attach a message to another user conversation', async () => {
    const conv = await asUser(db, alice, async () => (await db.query<{ id: string }>(
      `insert into public.conversations (user_id) values ($1) returning id`, [alice])).rows[0].id);
    await expectDenied(asUser(db, bob, () =>
      db.query(`insert into public.messages (conversation_id, user_id, role, content) values ($1,$2,'user','hi')`,
        [conv, bob])));
  });
});

describe('RLS: privilege escalation guards', () => {
  it('users cannot change their own plan', async () => {
    await expectDenied(asUser(db, alice, () =>
      db.query(`update public.profiles set plan_id = 'premium' where id = $1`, [alice])));
    const p = await db.query<{ plan_id: string }>('select plan_id from public.profiles where id = $1', [alice]);
    expect(p.rows[0].plan_id).toBe('free');
  });

  it('users can edit allowed profile fields', async () => {
    await asUser(db, alice, () =>
      db.query(`update public.profiles set display_name = 'Alice O.', timezone = 'Africa/Lagos' where id = $1`, [alice]));
    const p = await db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [alice]);
    expect(p.rows[0].display_name).toBe('Alice O.');
  });

  it('users cannot forge notifications or automation runs', async () => {
    await expectDenied(asUser(db, alice, () =>
      db.query(`insert into public.notifications (user_id, type, title) values ($1,'system','fake')`, [alice])));
    await expectDenied(asUser(db, alice, () =>
      db.query(`insert into public.automation_runs (rule_id, user_id, status) values (gen_random_uuid(), $1,'success')`, [alice])));
  });

  it('users cannot read the rate-limit table or call internal functions', async () => {
    await expectDenied(asUser(db, alice, () => db.query('select * from public.rate_limits')));
    await expectDenied(asUser(db, alice, () => db.query('select public.process_due_reminders()')));
    await expectDenied(asUser(db, alice, () => db.query('select public.run_automations()')));
  });

  it('audit logs cannot be edited or deleted by the user', async () => {
    await asUser(db, alice, () =>
      db.query(`insert into public.activity_logs (user_id, action) values ($1,'x')`, [alice]));
    await expectDenied(asUser(db, alice, () => db.query(`delete from public.activity_logs`)));
    await expectDenied(asUser(db, alice, () => db.query(`update public.activity_logs set action = 'y'`)));
  });
});

describe('Storage policies (private documents bucket)', () => {
  it('bucket is private', async () => {
    const b = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'documents'`);
    expect(b.rows[0].public).toBe(false);
  });

  it('users can only touch objects inside their own folder', async () => {
    await asUser(db, alice, () => db.query(
      `insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${alice}/a.pdf`]));
    await expectDenied(asUser(db, bob, () => db.query(
      `insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${alice}/evil.pdf`])));
    const seen = await asUser(db, bob, () => db.query(`select * from storage.objects`));
    expect(seen.rows).toHaveLength(0);
    const own = await asUser(db, alice, () => db.query(`select * from storage.objects`));
    expect(own.rows).toHaveLength(1);
  });
});

describe('Plan limits and quotas', () => {
  it('enforces the free-plan automation limit in the database', async () => {
    const u = await createUser(db, 'limits@example.com');
    await asUser(db, u, async () => {
      for (let i = 0; i < 3; i++) {
        await db.query(
          `insert into public.automation_rules (user_id, name, trigger_type, action_type)
           values ($1, $2, 'daily', 'notify')`, [u, `rule ${i}`]);
      }
    });
    await expectDenied(asUser(db, u, () => db.query(
      `insert into public.automation_rules (user_id, name, trigger_type, action_type)
       values ($1, 'one too many', 'daily', 'notify')`, [u])));
  });

  it('consume_ai_quota allows within limits and blocks bursts', async () => {
    const u = await createUser(db, 'quota@example.com');
    const results: Array<{ allowed: boolean; reason?: string }> = [];
    await asUser(db, u, async () => {
      for (let i = 0; i < 14; i++) {
        const r = await db.query<{ q: { allowed: boolean; reason?: string } }>('select public.consume_ai_quota() as q');
        results.push(r.rows[0].q);
      }
    });
    expect(results.slice(0, 12).every((r) => r.allowed)).toBe(true);
    expect(results[12]).toMatchObject({ allowed: false, reason: 'rate_limited' });
  });
});
