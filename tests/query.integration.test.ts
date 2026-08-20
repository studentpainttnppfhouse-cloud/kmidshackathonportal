import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { compile, type QuerySpec } from '@/lib/db/query';

/**
 * The compiler tests next door assert the SQL *string*. That catches a dropped
 * filter, but it cannot catch SQL that reads perfectly and Postgres refuses —
 * which is exactly how the missing `as t0` on INSERT got through, since the
 * expected string in the test had the same bug as the code.
 *
 * So this file sends every statement shape to a real server and checks it is
 * accepted. It runs against TEST_DATABASE_URL and skips when that is unset, so
 * `npm test` still works with nothing installed; point it at a database with
 * the schema applied — `npm run db:setup` — to have it run.
 *
 * The statements are prepared rather than executed. `prepare` puts a statement
 * through the parser, the rewriter and the planner, so anything malformed or
 * referring to a column that does not exist fails here — without writing a row.
 */
/** Any well-formed value will do — nothing is executed, only planned. */
const UUID = '00000000-0000-0000-0000-000000000000';

const CONNECTION = process.env.TEST_DATABASE_URL;
const describeIfDb = CONNECTION ? describe : describe.skip;

describeIfDb('every statement shape is valid SQL', () => {
  let client: pg.Client;
  let n = 0;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: CONNECTION });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  /** Plan the statement without running it. Throws if Postgres will not take it. */
  async function accepts(spec: QuerySpec) {
    const { text, values } = compile(spec);
    const name = `shape_${(n += 1)}`;
    try {
      await client.query({
        text: `prepare ${name} as ${text}`,
        values: [],
      });
    } catch (error) {
      throw new Error(
        `Postgres refused the generated SQL:\n  ${text}\n  ${(error as Error).message}`,
      );
    }
    expect(values.length).toBeGreaterThanOrEqual(0);
  }

  const base = (patch: Partial<QuerySpec>): QuerySpec => ({
    table: 'users',
    kind: 'select',
    filters: [],
    orders: [],
    ...patch,
  });

  it('accepts a filtered, ordered, limited select', async () => {
    await accepts(
      base({
        columns: 'id, email, tier',
        filters: [{ column: 'deleted_at', op: 'is', value: null }],
        orders: [{ column: 'nickname', ascending: true, nullsFirst: false }],
        limit: 50,
      }),
    );
  });

  it('accepts a select that counts as well as reads', async () => {
    await accepts(base({ columns: 'id', count: true, limit: 10 }));
  });

  it('accepts a head count', async () => {
    await accepts(base({ columns: 'id', count: true, head: true }));
  });

  it('accepts an embed through a named foreign key', async () => {
    await accepts(
      base({
        table: 'announcements',
        columns: 'id, title, users:author_id ( nickname, name )',
      }),
    );
  });

  it('accepts an embed resolved from a table name', async () => {
    await accepts(base({ table: 'spreadsheets', columns: 'id, departments ( name )' }));
  });

  it('accepts a nested one-to-many embed', async () => {
    await accepts(
      base({
        table: 'assignments',
        columns: 'id, assignment_assignees ( user_id, users ( nickname, name ) )',
      }),
    );
  });

  it('accepts an embedded count', async () => {
    await accepts(base({ table: 'forms', columns: 'id, title, form_responses(count)' }));
  });

  it('accepts an insert that returns its row', async () => {
    await accepts(
      base({
        kind: 'insert',
        values: { email: 'someone@kmids.ac.th', tier: 'T1', status: 'active' },
        columns: 'id, email',
      }),
    );
  });

  it('accepts a multi-row insert', async () => {
    await accepts(
      base({
        table: 'assignment_assignees',
        kind: 'insert',
        values: [
          { assignment_id: null, user_id: null },
          { assignment_id: null, user_id: null },
        ],
      }),
    );
  });

  it('accepts an upsert that updates on conflict', async () => {
    await accepts(
      base({
        table: 'checkins',
        kind: 'upsert',
        values: { user_id: null, day: null, checked_in_at: null },
        onConflict: 'user_id,day',
        columns: 'user_id',
      }),
    );
  });

  it('accepts an upsert with nothing left to update', async () => {
    await accepts(
      base({
        table: 'announcement_reads',
        kind: 'upsert',
        values: { announcement_id: null, user_id: null },
        onConflict: 'announcement_id,user_id',
      }),
    );
  });

  it('accepts a filtered update that returns its row', async () => {
    await accepts(
      base({
        kind: 'update',
        values: { status: 'suspended' },
        filters: [{ column: 'id', op: 'eq', value: UUID }],
        columns: 'id, email',
      }),
    );
  });

  it('accepts a filtered delete', async () => {
    await accepts(
      base({
        table: 'file_blobs',
        kind: 'delete',
        filters: [{ column: 'file_id', op: 'eq', value: UUID }],
      }),
    );
  });

  it('accepts an in() filter', async () => {
    await accepts(
      base({
        table: 'comments',
        columns: 'id, body, users:user_id ( nickname )',
        filters: [
          { column: 'parent_type', op: 'eq', value: 'assignment' },
          { column: 'parent_id', op: 'in', value: [] },
        ],
      }),
    );
  });
});
