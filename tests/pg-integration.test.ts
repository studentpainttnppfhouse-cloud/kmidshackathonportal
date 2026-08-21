/**
 * The query builder against a real PostgreSQL, with the real migrations.
 *
 * Unit tests can only prove the SQL text looks right. These prove it runs,
 * that embeds come back in the shape the screens destructure, and — the part
 * that actually matters — that the RLS policies still filter rows when the
 * connection is put into a user's shoes the way `withRls` does it.
 *
 * Skipped unless TEST_DATABASE_URL points at a scratch database:
 *   npm run db:testdb   # sets one up locally
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createClient, type PgClient } from '@/lib/pg/client';
import { registerTypeParsers } from '@/lib/pg/types';
import { SET_CLAIMS_SQL, jwtClaims, roleFor } from '@/lib/pg/rls';

const url = process.env.TEST_DATABASE_URL;
const run = url ? describe : describe.skip;

let pool: pg.Pool;

/** The same per-statement RLS transaction the Aurora pool opens. */
function clientFor(userId: string | null, bypassRls = false): PgClient {
  return createClient(async (text, values) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (!bypassRls) {
        await client.query(SET_CLAIMS_SQL, [jwtClaims(userId)]);
        await client.query(`set local role ${roleFor(userId)}`);
      }
      const result = await client.query(text, values);
      await client.query('commit');
      return result.rows;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
}

run('query builder against real Postgres', () => {
  let owner: string;
  let member: string;
  let otherDeptMember: string;

  beforeAll(async () => {
    registerTypeParsers();
    pool = new pg.Pool({ connectionString: url });
    const admin = clientFor(null, true);

    const { data: owners } = await admin
      .from<{ id: string }>('users')
      .select('id')
      .eq('tier', 'T4')
      .limit(1)
      .maybeSingle();
    owner = owners!.id;

    const { data: members } = await admin
      .from<{ id: string; department_id: string }>('users')
      .select('id, department_id')
      .eq('tier', 'T1')
      .is('deleted_at', null)
      .limit(5);
    const list = members as unknown as { id: string; department_id: string }[];
    member = list[0]!.id;
    otherDeptMember = list.find((u) => u.department_id !== list[0]!.department_id)!.id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('runs a plain filtered select', async () => {
    const db = clientFor(owner);
    const { data, error } = await db
      .from('departments')
      .select('id, name, slug, sort_order')
      .is('deleted_at', null)
      .order('sort_order');

    expect(error).toBeNull();
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });

  it('embeds a to-one relation as an object, and null when absent', async () => {
    const db = clientFor(owner);
    const { data, error } = await db
      .from('documents')
      .select('id, title, owner:owner_id ( nickname, name ), approver:approved_by ( nickname )')
      .is('deleted_at', null)
      .limit(5);

    expect(error).toBeNull();
    const rows = data as unknown as {
      owner: { nickname: string | null } | null;
      approver: { nickname: string | null } | null;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // owner_id is set on every seeded document; approved_by mostly is not.
      expect(row.owner === null || typeof row.owner === 'object').toBe(true);
      expect(row.approver === null || typeof row.approver === 'object').toBe(true);
    }
  });

  it('embeds a nested to-many relation the way the assignments screen reads it', async () => {
    const db = clientFor(owner);
    const { data, error } = await db
      .from('assignments')
      .select(
        'id, title, assignment_assignees ( user_id, users ( nickname, name ) )',
      )
      .is('deleted_at', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(300);

    expect(error).toBeNull();
    const rows = data as unknown as {
      assignment_assignees: { user_id: string; users: { nickname: string | null } | null }[];
    }[];
    expect(rows.length).toBeGreaterThan(0);
    // Empty must be [] and never null — the screen maps over it directly.
    for (const row of rows) expect(Array.isArray(row.assignment_assignees)).toBe(true);

    const withAssignee = rows.find((r) => r.assignment_assignees.length > 0);
    expect(withAssignee).toBeDefined();
    expect(withAssignee!.assignment_assignees[0]!.users).toHaveProperty('nickname');
  });

  it('returns the count embed as [{ count }]', async () => {
    const db = clientFor(owner);
    const { data, error } = await db
      .from('forms')
      .select('id, title, form_responses(count)')
      .is('deleted_at', null);

    expect(error).toBeNull();
    const rows = data as unknown as { form_responses: { count: number }[] }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Array.isArray(row.form_responses)).toBe(true);
      expect(typeof row.form_responses[0]!.count).toBe('number');
    }
  });

  it('gives timestamps back as strings, not Date objects', async () => {
    const db = clientFor(owner);
    const { data } = await db.from('users').select('id, created_at').limit(1).maybeSingle();
    const row = data as unknown as { created_at: unknown };
    expect(typeof row.created_at).toBe('string');
    expect(Number.isNaN(Date.parse(row.created_at as string))).toBe(false);
  });

  it('still enforces row-level security on writes', async () => {
    // A T1 Member may not change another member's tier — the privilege guard
    // and the users policies both refuse it.
    const db = clientFor(member);
    const { error } = await db
      .from('users')
      .update({ tier: 'T4' })
      .eq('id', otherDeptMember)
      .select('id')
      .maybeSingle();

    const refused = error !== null;
    if (!refused) {
      // If no error was raised, the policy must at least have matched no rows.
      const admin = clientFor(null, true);
      const { data } = await admin
        .from<{ tier: string }>('users')
        .select('tier')
        .eq('id', otherDeptMember)
        .maybeSingle();
      expect(data!.tier).not.toBe('T4');
    } else {
      expect(error!.message.length).toBeGreaterThan(0);
    }
  });

  it('scopes reads by the signed-in user, not by the process', async () => {
    // The anon role reaches published forms and nothing else.
    const anon = clientFor(null);
    const { data: users } = await anon.from('users').select('id').limit(5);
    expect((users as unknown[]) ?? []).toHaveLength(0);
  });

  it('round-trips an insert, update and delete with returning', async () => {
    const db = clientFor(owner);

    const { data: created, error: insertError } = await db
      .from<{ id: string; title: string }>('assignments')
      .insert({
        title: 'Builder round trip',
        priority: 'high',
        status: 'not_started',
        created_by: owner,
      })
      .select('id, title')
      .maybeSingle();

    expect(insertError).toBeNull();
    expect(created!.title).toBe('Builder round trip');

    const { error: updateError } = await db
      .from('assignments')
      .update({ status: 'in_progress' })
      .eq('id', created!.id);
    expect(updateError).toBeNull();

    const { data: after } = await db
      .from<{ status: string }>('assignments')
      .select('status')
      .eq('id', created!.id)
      .maybeSingle();
    expect(after!.status).toBe('in_progress');

    // `assignments_soft_delete` turns a DELETE into a deleted_at stamp, so the
    // row survives but drops out of every query that filters on it — which is
    // what all of them do.
    await db.from('assignments').delete().eq('id', created!.id);
    const { data: gone } = await db
      .from('assignments')
      .select('id')
      .eq('id', created!.id)
      .is('deleted_at', null)
      .maybeSingle();
    expect(gone).toBeNull();
  });

  it('upserts on a composite key', async () => {
    const db = clientFor(member);
    const day = '2027-03-20';

    await db.from('checkins').upsert(
      { user_id: member, day, checked_in_at: new Date().toISOString(), station: 'Front desk' },
      { onConflict: 'user_id,day' },
    );
    const { error } = await db.from('checkins').upsert(
      { user_id: member, day, checked_in_at: new Date().toISOString(), station: 'Stage door' },
      { onConflict: 'user_id,day' },
    );
    expect(error).toBeNull();

    const admin = clientFor(null, true);
    const { data } = await admin
      .from('checkins')
      .select('user_id')
      .eq('user_id', member)
      .eq('day', day);
    expect((data as unknown[]).length).toBe(1);
  });
});
