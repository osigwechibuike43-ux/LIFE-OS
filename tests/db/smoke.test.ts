// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, createUser } from './harness';

describe('migrations', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createDb();
  }, 60_000);

  it('applies cleanly and bootstraps a new user', async () => {
    const id = await createUser(db, 'ada@example.com', { full_name: 'Ada Obi' });
    const profile = await db.query<{ display_name: string; plan_id: string }>(
      'select display_name, plan_id from lifeos.profiles where id = $1', [id]);
    expect(profile.rows[0]).toEqual({ display_name: 'Ada Obi', plan_id: 'free' });
    const cats = await db.query('select 1 from lifeos.task_categories where user_id = $1', [id]);
    expect(cats.rows).toHaveLength(7);
    const prefs = await db.query('select 1 from lifeos.user_preferences where user_id = $1', [id]);
    expect(prefs.rows).toHaveLength(1);
  });
});
