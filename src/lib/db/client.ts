import 'server-only';
import type { PoolClient } from 'pg';
import { pool } from './pool';
import { compile, QueryError, type Filter, type Order, type QuerySpec } from './query';

/**
 * The database handle every server module uses.
 *
 * `db.from('users').select('…').eq('id', id).maybeSingle()` describes a query;
 * query.ts turns it into SQL; the runner underneath decides *as whom* it runs.
 * That last part is the important one — see `asUser` below.
 */

/**
 * A row of unknown shape.
 *
 * The tables here are described in SQL, not in TypeScript, so a builder cannot
 * know what a select list will return — `select('id, name')` and
 * `select('*')` produce different shapes from the same call. Rather than
 * invent a generated type layer for a schema that changes once a season, the
 * row type is left open and the call sites narrow it: most pass an explicit
 * shape (`maybeSingle<AppUser>()`), and the rest cast the result into the
 * interface the page renders from.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface DbError {
  message: string;
  /** The SQLSTATE, when Postgres supplied one. */
  code?: string;
}

export interface DbResult<T> {
  data: T;
  error: DbError | null;
  count: number | null;
}

/** Runs one compiled statement. What varies is the role it runs under. */
type Runner = (text: string, values: unknown[]) => Promise<{ rows: Row[] }>;

function toDbError(error: unknown): DbError {
  if (error instanceof QueryError) return { message: error.message };
  const e = error as { message?: string; code?: string; detail?: string };
  return { message: e?.message ?? 'Database error', code: e?.code };
}

class Builder<T> implements PromiseLike<DbResult<T>> {
  private readonly spec: QuerySpec;

  constructor(private readonly run: Runner, spec: QuerySpec) {
    this.spec = spec;
  }

  private next<U>(patch: Partial<QuerySpec>): Builder<U> {
    return new Builder<U>(this.run, { ...this.spec, ...patch });
  }

  // -- shape ----------------------------------------------------------------

  select<R = Row>(
    columns = '*',
    options: { count?: 'exact'; head?: boolean } = {},
  ): Builder<R[]> {
    return this.next<R[]>({
      columns,
      count: options.count === 'exact' ? true : this.spec.count,
      head: options.head ?? this.spec.head,
    });
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): Builder<Row[]> {
    return this.next({ kind: 'insert', values, columns: undefined });
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflict?: string } = {},
  ): Builder<Row[]> {
    return this.next({
      kind: 'upsert',
      values,
      onConflict: options.onConflict,
      columns: undefined,
    });
  }

  update(values: Record<string, unknown>): Builder<Row[]> {
    return this.next({ kind: 'update', values, columns: undefined });
  }

  delete(): Builder<Row[]> {
    return this.next({ kind: 'delete', columns: undefined });
  }

  // -- filters --------------------------------------------------------------

  private filter(column: string, op: Filter['op'], value: unknown): Builder<T> {
    return this.next({ filters: [...this.spec.filters, { column, op, value }] });
  }

  eq(column: string, value: unknown) { return this.filter(column, 'eq', value); }
  neq(column: string, value: unknown) { return this.filter(column, 'neq', value); }
  gt(column: string, value: unknown) { return this.filter(column, 'gt', value); }
  gte(column: string, value: unknown) { return this.filter(column, 'gte', value); }
  lt(column: string, value: unknown) { return this.filter(column, 'lt', value); }
  lte(column: string, value: unknown) { return this.filter(column, 'lte', value); }
  like(column: string, value: string) { return this.filter(column, 'like', value); }
  ilike(column: string, value: string) { return this.filter(column, 'ilike', value); }
  is(column: string, value: null | boolean) { return this.filter(column, 'is', value); }
  in(column: string, values: readonly unknown[]) { return this.filter(column, 'in', [...values]); }

  order(
    column: string,
    options: { ascending?: boolean; nullsFirst?: boolean } = {},
  ): Builder<T> {
    const order: Order = {
      column,
      ascending: options.ascending ?? true,
      // Postgres defaults to nulls last on asc and nulls first on desc; being
      // explicit means a list does not silently reorder when a sort flips.
      nullsFirst: options.nullsFirst ?? false,
    };
    return this.next({ orders: [...this.spec.orders, order] });
  }

  limit(count: number): Builder<T> {
    return this.next({ limit: count });
  }

  // -- execution ------------------------------------------------------------

  /** Exactly one row, or an error. */
  async single<R = Row>(): Promise<DbResult<R | null>> {
    const result = await this.rows();
    if (result.error) return { data: null, error: result.error, count: null };
    if (result.data.length !== 1) {
      return {
        data: null,
        error: {
          message:
            result.data.length === 0
              ? 'No rows returned, but exactly one was expected'
              : `${result.data.length} rows returned, but exactly one was expected`,
        },
        count: null,
      };
    }
    return { data: (result.data[0] ?? null) as R | null, error: null, count: result.count };
  }

  /** The first row, or null. Not finding one is not an error. */
  async maybeSingle<R = Row>(): Promise<DbResult<R | null>> {
    const result = await this.rows();
    if (result.error) return { data: null, error: result.error, count: null };
    return { data: (result.data[0] ?? null) as R | null, error: null, count: result.count };
  }

  then<R1 = DbResult<T>, R2 = never>(
    onFulfilled?: ((value: DbResult<T>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.rows().then((result) => result as unknown as DbResult<T>).then(
      onFulfilled,
      onRejected,
    );
  }

  /** The SQL this builder would run. Used by tests and by the export route. */
  toSQL() {
    return compile(this.spec);
  }

  private async rows(): Promise<DbResult<Row[]>> {
    try {
      const { text, values } = compile(this.spec);
      const result = await this.run(text, values);

      if (this.spec.head) {
        const count = Number(result.rows[0]?.count ?? 0);
        return { data: [], error: null, count };
      }

      let count: number | null = null;
      const rows = result.rows.map((row) => {
        if ('__count' in row) {
          count = Number(row.__count);
          const { __count, ...rest } = row;
          void __count;
          return rest;
        }
        return row;
      });

      return { data: rows, error: null, count };
    } catch (error) {
      return { data: [], error: toDbError(error), count: null };
    }
  }
}

export interface Db {
  from(table: string): Builder<Row[]>;
}

function handle(run: Runner): Db {
  return {
    from(table: string) {
      return new Builder<Row[]>(run, {
        table,
        kind: 'select',
        filters: [],
        orders: [],
      });
    },
  };
}

/** Straight to the pool, as the connection's own role. No RLS applies. */
const serviceRunner: Runner = async (text, values) => {
  const result = await pool().query(text, values);
  return { rows: result.rows as Row[] };
};

/**
 * Everything the app does on its own behalf rather than a user's: resolving a
 * session cookie back to a user (which has to happen before there is a user to
 * act as), provisioning an account on first sign-in, writing the audit log,
 * and applying the Owner Console decisions the privilege trigger deliberately
 * refuses from an ordinary session.
 *
 * Every other read and write goes through `asUser` so the database — not this
 * process — decides what is allowed.
 */
export function admin(): Db {
  return handle(serviceRunner);
}

/**
 * Runs as a specific signed-in user, with row-level security applied.
 *
 * This is what carries the permission model. Each statement runs inside a
 * transaction that sets `request.jwt.claims` and switches to the
 * `authenticated` role, and every policy in db/migrations reads the user id
 * back out through `app.uid()`. So the tier rules live in one place — SQL —
 * and a bug in a page cannot hand someone another department's data.
 *
 * Both settings are transaction-local, so a connection handed back to the pool
 * carries no trace of the user it just served.
 */
export function asUser(userId: string): Db {
  return handle(runAs(userId));
}

/** The logged-out visitor, for the public form pages. */
export function asAnon(): Db {
  return handle(runAs(null));
}

function runAs(userId: string | null): Runner {
  return async (text, values) => {
    const client = await pool().connect();
    try {
      return await inRole(client, userId, async () => {
        const result = await client.query(text, values);
        return { rows: result.rows as Row[] };
      });
    } finally {
      client.release();
    }
  };
}

async function inRole<T>(
  client: PoolClient,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify(
    userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' },
  );

  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

/**
 * Several statements as one unit, as a given user.
 *
 * Used where a half-applied change would be worse than a failed one — moving a
 * form response into a real account, say, which writes to three tables.
 */
export async function transactionAsUser<T>(
  userId: string | null,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  const runner: Runner = async (text, values) => {
    const result = await client.query(text, values);
    return { rows: result.rows as Row[] };
  };

  try {
    return await inRole(client, userId, () => fn(handle(runner)));
  } finally {
    client.release();
  }
}

/** One raw statement as the service role, for health checks and migrations. */
export async function sql<T = Row>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await pool().query(text, values);
  return result.rows as T[];
}
