// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, createDb, createUser } from './harness';

let db: PGlite;
let u: string;

beforeAll(async () => {
  db = await createDb();
  u = await createUser(db, 'logic@example.com');
}, 60_000);

describe('tasks: complete_task', () => {
  it('marks a task done and logs activity', async () => {
    const id = await asUser(db, u, async () => {
      const t = await db.query<{ id: string }>(`insert into lifeos.tasks (user_id, title) values ($1,'one-off') returning id`, [u]);
      await db.query('select lifeos.complete_task($1)', [t.rows[0].id]);
      return t.rows[0].id;
    });
    const row = await db.query<{ status: string; completed_at: string | null }>(
      'select status, completed_at from lifeos.tasks where id = $1', [id]);
    expect(row.rows[0].status).toBe('done');
    expect(row.rows[0].completed_at).not.toBeNull();
    const log = await db.query(`select 1 from lifeos.activity_logs where entity_id = $1 and action = 'task.completed'`, [id]);
    expect(log.rows).toHaveLength(1);
  });

  it('spawns the next occurrence for recurring tasks, in the future', async () => {
    await asUser(db, u, async () => {
      const t = await db.query<{ id: string }>(
        `insert into lifeos.tasks (user_id, title, due_at, recurrence)
         values ($1,'daily standup', now() - interval '3 days', '{"freq":"daily","interval":1}') returning id`, [u]);
      await db.query('select lifeos.complete_task($1)', [t.rows[0].id]);
    });
    const open = await db.query<{ due_at: string }>(
      `select due_at from lifeos.tasks where user_id = $1 and title = 'daily standup' and status <> 'done'`, [u]);
    expect(open.rows).toHaveLength(1);
    expect(new Date(open.rows[0].due_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses to complete another user task', async () => {
    const other = await createUser(db, 'other@example.com');
    const tid = (await db.query<{ id: string }>(
      `insert into lifeos.tasks (user_id, title) values ($1,'not yours') returning id`, [other])).rows[0].id;
    await expect(asUser(db, u, () => db.query('select lifeos.complete_task($1)', [tid]))).rejects.toThrow(/not found/i);
  });

  it('rejects invalid recurrence rules', async () => {
    await expect(asUser(db, u, () => db.query(
      `insert into lifeos.tasks (user_id, title, recurrence) values ($1,'bad','{"freq":"hourly"}')`, [u]))).rejects.toThrow();
  });
});

describe('reminders', () => {
  it('notifies a due reminder exactly once, and never a future one', async () => {
    await asUser(db, u, async () => {
      await db.query(`insert into lifeos.reminders (user_id, title, remind_at) values ($1,'due now', now() - interval '1 minute')`, [u]);
      await db.query(`insert into lifeos.reminders (user_id, title, remind_at) values ($1,'later', now() + interval '2 hours')`, [u]);
    });
    const first = await db.query<{ process_due_reminders: number }>('select lifeos.process_due_reminders()');
    expect(first.rows[0].process_due_reminders).toBe(1);
    const second = await db.query<{ process_due_reminders: number }>('select lifeos.process_due_reminders()');
    expect(second.rows[0].process_due_reminders).toBe(0);
    const n = await db.query(`select 1 from lifeos.notifications where user_id = $1 and title = 'due now'`, [u]);
    expect(n.rows).toHaveLength(1);
  });

  it('rolls a recurring reminder forward instead of finishing it', async () => {
    await asUser(db, u, () => db.query(
      `insert into lifeos.reminders (user_id, title, remind_at, recurrence)
       values ($1,'weekly review', now() - interval '1 minute', '{"freq":"weekly","interval":1}')`, [u]));
    await db.query('select lifeos.process_due_reminders()');
    const r = await db.query<{ remind_at: string; notified_at: string | null; status: string }>(
      `select remind_at, notified_at, status from lifeos.reminders where title = 'weekly review'`);
    expect(r.rows[0].status).toBe('pending');
    expect(r.rows[0].notified_at).toBeNull();
    expect(new Date(r.rows[0].remind_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('respects the in-app notification preference', async () => {
    const quiet = await createUser(db, 'quiet@example.com');
    await db.query(`update lifeos.user_preferences set notifications_in_app = false where user_id = $1`, [quiet]);
    await db.query(`insert into lifeos.reminders (user_id, title, remind_at) values ($1,'silent', now() - interval '1 minute')`, [quiet]);
    await db.query('select lifeos.process_due_reminders()');
    const n = await db.query(`select 1 from lifeos.notifications where user_id = $1`, [quiet]);
    expect(n.rows).toHaveLength(0);
  });
});

describe('automations', () => {
  it('computes next_run_at on creation and runs due rules with history', async () => {
    const rule = await asUser(db, u, async () => (await db.query<{ id: string; next_run_at: string }>(
      `insert into lifeos.automation_rules (user_id, name, trigger_type, trigger_config, action_type, action_config)
       values ($1,'Morning nudge','daily','{"time":"08:00"}','notify','{"title":"Review your tasks"}')
       returning id, next_run_at`, [u])).rows[0]);
    expect(new Date(rule.next_run_at).getTime()).toBeGreaterThan(Date.now());

    // Force the rule to be due, then run the engine.
    await db.query(`update lifeos.automation_rules set next_run_at = now() - interval '1 minute' where id = $1`, [rule.id]);
    const ran = await db.query<{ run_automations: number }>('select lifeos.run_automations()');
    expect(ran.rows[0].run_automations).toBeGreaterThanOrEqual(1);

    const runs = await db.query<{ status: string }>('select status from lifeos.automation_runs where rule_id = $1', [rule.id]);
    expect(runs.rows.map((r) => r.status)).toEqual(['success']);
    const note = await db.query(`select 1 from lifeos.notifications where user_id = $1 and title = 'Review your tasks'`, [u]);
    expect(note.rows).toHaveLength(1);

    const after = await db.query<{ next_run_at: string; last_run_at: string }>(
      'select next_run_at, last_run_at from lifeos.automation_rules where id = $1', [rule.id]);
    expect(new Date(after.rows[0].next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(after.rows[0].last_run_at).not.toBeNull();
  });

  it('skips when a condition is not met and records why', async () => {
    const lonely = await createUser(db, 'nolist@example.com');
    const rule = (await db.query<{ id: string }>(
      `insert into lifeos.automation_rules (user_id, name, trigger_type, action_type, conditions)
       values ($1,'Only with tasks','daily','notify','{"only_if_open_tasks":true}') returning id`, [lonely])).rows[0].id;
    await db.query(`update lifeos.automation_rules set next_run_at = now() - interval '1 minute' where id = $1`, [rule]);
    await db.query('select lifeos.run_automations()');
    const runs = await db.query<{ status: string }>('select status from lifeos.automation_runs where rule_id = $1', [rule]);
    expect(runs.rows[0].status).toBe('skipped');
  });

  it('the weekly summary reports real numbers', async () => {
    const w = await createUser(db, 'weekly@example.com');
    await db.query(`insert into lifeos.tasks (user_id, title, status, completed_at) values
      ($1,'a','done', now()), ($1,'b','done', now()), ($1,'c','todo', null)`, [w]);
    const rule = (await db.query<{ id: string }>(
      `insert into lifeos.automation_rules (user_id, name, trigger_type, action_type)
       values ($1,'Weekly','weekly','weekly_summary') returning id`, [w])).rows[0].id;
    await db.query(`update lifeos.automation_rules set next_run_at = now() - interval '1 minute' where id = $1`, [rule]);
    await db.query('select lifeos.run_automations()');
    const n = await db.query<{ body: string }>(`select body from lifeos.notifications where user_id = $1`, [w]);
    expect(n.rows[0].body).toContain('Completed 2 tasks');
    expect(n.rows[0].body).toContain('1 still open');
  });

  it('deadline alerts fire once per task', async () => {
    const d = await createUser(db, 'deadline@example.com');
    await db.query(`insert into lifeos.tasks (user_id, title, due_at, priority)
      values ($1,'Submit report', now() + interval '2 days','high')`, [d]);
    const rule = (await db.query<{ id: string }>(
      `insert into lifeos.automation_rules (user_id, name, trigger_type, trigger_config, action_type)
       values ($1,'3-day warning','before_deadline','{"days_before":3}','deadline_alert') returning id`, [d])).rows[0].id;
    for (let i = 0; i < 2; i++) {
      await db.query(`update lifeos.automation_rules set next_run_at = now() - interval '1 minute' where id = $1`, [rule]);
      await db.query('select lifeos.run_automations()');
    }
    const n = await db.query(`select 1 from lifeos.notifications where user_id = $1 and type = 'deadline'`, [d]);
    expect(n.rows).toHaveLength(1);
  });
});

describe('notes full-text search', () => {
  it('finds notes by title, body and tags', async () => {
    await asUser(db, u, () => db.query(
      `insert into lifeos.notes (user_id, title, content_text, tags) values ($1,'Trip plan','visit Abuja in March', array['travel'])`, [u]));
    const byBody = await asUser(db, u, () => db.query(
      `select title from lifeos.notes where search @@ plainto_tsquery('simple','abuja')`));
    const byTag = await asUser(db, u, () => db.query(
      `select title from lifeos.notes where search @@ plainto_tsquery('simple','travel')`));
    expect(byBody.rows).toHaveLength(1);
    expect(byTag.rows).toHaveLength(1);
  });
});
