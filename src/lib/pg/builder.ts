import { parseSelect, type SelectNode } from './select';
import { AliasCounter, ident, selectList } from './sql';

/**
 * A chainable query builder with PostgREST's shape and Postgres underneath.
 *
 * Awaiting one resolves to `{ data, error }` rather than throwing, because
 * that is the contract every call site in this app was written against: a
 * failed write is checked, not caught. Errors keep their Postgres message, so
 * the several places that test for `row-level security` in the text still
 * recognise a refusal by the policies.
 */

export interface PgError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * A discriminated union, like Supabase's: once `error` has been checked and
 * found null, `data` narrows to non-null. Several call sites lean on exactly
 * that — `if (error) throw …; return data;` — so a plainly-nullable pair would
 * have meant editing them.
 *
 * `count` is set only when the query asked for one.
 */
export type Result<T> =
  | { data: T; error: null; count: number | null }
  | { data: null; error: PgError; count: number | null };

/** Runs one statement. The client decides which role and RLS context it runs in. */
export type Executor = (sql: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

type Kind = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
type Row = Record<string, unknown>;

interface Order {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

function toPgError(error: unknown): PgError {
  const e = error as { message?: string; code?: string; detail?: string; hint?: string };
  return {
    message: e?.message ?? String(error),
    code: e?.code,
    details: e?.detail,
    hint: e?.hint,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `Row` is the shape of one record; `Data` is what `data` resolves to — an
 * array normally, a single record after `.single()` / `.maybeSingle()`. Both
 * default to `any`, matching the untyped Supabase client every call site here
 * was written against.
 */
export class QueryBuilder<Row_ = any, Data = Row_[]> implements PromiseLike<Result<Data>> {
  private kind: Kind = 'select';
  private payload: Row[] = [];
  private onConflict: string[] = [];
  private returning: SelectNode | null = null;
  private wheres: string[] = [];
  private params: unknown[] = [];
  private orders: Order[] = [];
  private take: number | null = null;
  private offset: number | null = null;
  private rowMode: 'many' | 'single' | 'maybe' = 'many';
  private wantCount = false;
  private headOnly = false;

  constructor(
    private readonly table: string,
    private readonly exec: Executor,
  ) {}

  // ---- verbs ---------------------------------------------------------------

  select(
    columns = '*',
    options: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean } = {},
  ): this {
    this.returning = parseSelect(columns);
    this.wantCount = Boolean(options.count);
    this.headOnly = Boolean(options.head);
    return this;
  }

  insert(values: Row | Row[]): this {
    this.kind = 'insert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  update(patch: Row): this {
    this.kind = 'update';
    this.payload = [patch];
    return this;
  }

  upsert(values: Row | Row[], options: { onConflict?: string } = {}): this {
    this.kind = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    this.onConflict = (options.onConflict ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    return this;
  }

  delete(): this {
    this.kind = 'delete';
    return this;
  }

  // ---- filters -------------------------------------------------------------

  private bind(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  private compare(column: string, operator: string, value: unknown): this {
    this.wheres.push(`${ident(column)} ${operator} ${this.bind(value)}`);
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.compare(column, '=', value);
  }

  neq(column: string, value: unknown): this {
    return this.compare(column, '<>', value);
  }

  gt(column: string, value: unknown): this {
    return this.compare(column, '>', value);
  }

  gte(column: string, value: unknown): this {
    return this.compare(column, '>=', value);
  }

  lt(column: string, value: unknown): this {
    return this.compare(column, '<', value);
  }

  lte(column: string, value: unknown): this {
    return this.compare(column, '<=', value);
  }

  like(column: string, pattern: string): this {
    return this.compare(column, 'like', pattern);
  }

  ilike(column: string, pattern: string): this {
    return this.compare(column, 'ilike', pattern);
  }

  /** `is(col, null)` and `is(col, true|false)` — the SQL `IS` operator. */
  is(column: string, value: null | boolean): this {
    const literal = value === null ? 'null' : value ? 'true' : 'false';
    this.wheres.push(`${ident(column)} is ${literal}`);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.wheres.push(`${ident(column)} = any(${this.bind([...values])})`);
    return this;
  }

  contains(column: string, values: readonly unknown[]): this {
    this.wheres.push(`${ident(column)} @> ${this.bind([...values])}`);
    return this;
  }

  // ---- shaping -------------------------------------------------------------

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this.orders.push({
      column,
      ascending: options.ascending ?? true,
      nullsFirst: options.nullsFirst,
    });
    return this;
  }

  limit(count: number): this {
    this.take = count;
    return this;
  }

  range(from: number, to: number): this {
    this.take = to - from + 1;
    this.offset = from;
    return this;
  }

  single<U = Row_>(): QueryBuilder<U, U> {
    this.rowMode = 'single';
    return this as unknown as QueryBuilder<U, U>;
  }

  maybeSingle<U = Row_>(): QueryBuilder<U, U | null> {
    this.rowMode = 'maybe';
    return this as unknown as QueryBuilder<U, U | null>;
  }

  /** PostgREST's `.returns<T>()` — a compile-time cast, no runtime effect. */
  returns<U>(): QueryBuilder<U, U[]> {
    return this as unknown as QueryBuilder<U, U[]>;
  }

  // ---- SQL -----------------------------------------------------------------

  private whereClause(): string {
    return this.wheres.length > 0 ? ` where ${this.wheres.join(' and ')}` : '';
  }

  private returningClause(alias: string): string {
    if (!this.returning) return '';
    const list = selectList(this.table, alias, this.returning, new AliasCounter()).join(', ');
    return ` returning ${list}`;
  }

  /** Column names shared by every row being written. */
  private payloadColumns(): string[] {
    const first = Object.keys(this.payload[0] ?? {});
    for (const row of this.payload) {
      const keys = Object.keys(row);
      const same = keys.length === first.length && keys.every((k) => first.includes(k));
      if (!same) {
        throw new Error(
          `Every row in an insert into "${this.table}" must set the same columns — ` +
            'otherwise a column left out of one row would override its default with null.',
        );
      }
    }
    return first;
  }

  private valuesClause(columns: string[]): string {
    return this.payload
      .map((row) => `(${columns.map((c) => this.bind(row[c])).join(', ')})`)
      .join(', ');
  }

  /** `select count(*)` over the same filters, for `{ count: 'exact' }`. */
  private compileCount(): { text: string; values: unknown[] } {
    return {
      text: `select count(*)::int as count from ${ident(this.table)}${this.whereClause()}`,
      values: this.params,
    };
  }

  private compile(): { text: string; values: unknown[] } {
    // Filters are built before we know the statement kind, so they reference
    // bare column names. Postgres resolves those against the single table in
    // play here, which is what PostgREST did too.
    switch (this.kind) {
      case 'select': {
        const counter = new AliasCounter();
        const list = selectList(
          this.table,
          this.table,
          this.returning ?? { columns: ['*'], embeds: [] },
          counter,
        ).join(', ');

        let sql = `select ${list} from ${ident(this.table)}${this.whereClause()}`;
        if (this.orders.length > 0) {
          const parts = this.orders.map((o) => {
            const direction = o.ascending ? 'asc' : 'desc';
            const nulls =
              o.nullsFirst === undefined ? '' : o.nullsFirst ? ' nulls first' : ' nulls last';
            return `${ident(o.column)} ${direction}${nulls}`;
          });
          sql += ` order by ${parts.join(', ')}`;
        }
        if (this.take !== null) sql += ` limit ${Number(this.take)}`;
        if (this.offset !== null) sql += ` offset ${Number(this.offset)}`;
        return { text: sql, values: this.params };
      }

      case 'insert':
      case 'upsert': {
        const columns = this.payloadColumns();
        if (columns.length === 0) throw new Error(`Nothing to insert into "${this.table}"`);
        const values = this.valuesClause(columns);
        let sql =
          `insert into ${ident(this.table)} (${columns.map(ident).join(', ')}) values ${values}`;

        if (this.kind === 'upsert') {
          if (this.onConflict.length === 0) {
            throw new Error(`upsert on "${this.table}" needs an onConflict column list`);
          }
          const updatable = columns.filter((c) => !this.onConflict.includes(c));
          sql +=
            ` on conflict (${this.onConflict.map(ident).join(', ')}) ` +
            (updatable.length > 0
              ? `do update set ${updatable.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`
              : 'do nothing');
        }

        sql += this.returningClause(this.table);
        return { text: sql, values: this.params };
      }

      case 'update': {
        const patch = this.payload[0] ?? {};
        const columns = Object.keys(patch);
        if (columns.length === 0) throw new Error(`Nothing to update on "${this.table}"`);
        // Bind the SET values before the WHERE params so placeholder numbers
        // line up with the order they appear in the statement.
        const setParams: unknown[] = [];
        const assignments = columns.map((c, i) => {
          setParams.push(patch[c]);
          return `${ident(c)} = $${i + 1}`;
        });
        const shifted = this.wheres.map((clause) =>
          clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + setParams.length}`),
        );
        const where = shifted.length > 0 ? ` where ${shifted.join(' and ')}` : '';
        const sql =
          `update ${ident(this.table)} set ${assignments.join(', ')}${where}` +
          this.returningClause(this.table);
        return { text: sql, values: [...setParams, ...this.params] };
      }

      case 'delete': {
        const sql =
          `delete from ${ident(this.table)}${this.whereClause()}` +
          this.returningClause(this.table);
        return { text: sql, values: this.params };
      }
    }
  }

  // ---- execution -----------------------------------------------------------

  private async run(): Promise<Result<Data>> {
    return (await this.execute()) as Result<Data>;
  }

  private async execute(): Promise<{
    data: unknown;
    error: PgError | null;
    count: number | null;
  }> {
    let rows: Row[];
    let count: number | null = null;

    try {
      if (this.wantCount) {
        const counting = this.compileCount();
        const counted = await this.exec(counting.text, counting.values);
        count = Number(counted[0]?.count ?? 0);
      }
      // `head: true` asks for the count and nothing else, so skip the rows.
      if (this.headOnly) return { data: null, error: null, count };

      const { text, values } = this.compile();
      rows = await this.exec(text, values);
    } catch (error) {
      return { data: null, error: toPgError(error), count: null };
    }

    // A mutation with no `.select()` returns no rows, matching PostgREST's
    // default of `Prefer: return=minimal`.
    if (this.kind !== 'select' && !this.returning) {
      return { data: null, error: null, count };
    }

    if (this.rowMode === 'many') return { data: rows as Data, error: null, count };

    if (rows.length > 1) {
      return {
        data: null,
        count,
        error: {
          message: `Expected one row from "${this.table}", got ${rows.length}`,
          code: 'PGRST116',
        },
      };
    }
    if (rows.length === 0) {
      if (this.rowMode === 'maybe') return { data: null, error: null, count };
      return {
        data: null,
        count,
        error: { message: `No rows found in "${this.table}"`, code: 'PGRST116' },
      };
    }
    return { data: rows[0] as Data, error: null, count };
  }

  then<A = Result<Data>, B = never>(
    onFulfilled?: ((value: Result<Data>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onFulfilled, onRejected);
  }
}
