import { belongsToColumn, FOREIGN_KEYS, hasManyColumn } from './relations';

/**
 * Compiles a query description into one parameterised SQL statement.
 *
 * The portal used to reach the database over PostgREST, so its call sites are
 * written as a chain of filters ending in a select list that can pull related
 * rows inline. That shape is a good one — it reads well and it keeps a page's
 * data in a single round trip — so it survived the move to a direct
 * connection, and this module is what turns it into SQL.
 *
 * Nothing here touches the network, which is the point: the whole compiler is
 * pure, so tests/query.test.ts can assert the exact SQL for every shape the
 * app uses without a database anywhere near it.
 *
 * Two rules hold throughout:
 *   - every value is a bind parameter, never interpolated;
 *   - every identifier is checked against `IDENT` before it reaches the
 *     string, so a column name arriving from a caller cannot become syntax.
 */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class QueryError extends Error {}

function ident(name: string): string {
  if (!IDENT.test(name)) {
    throw new QueryError(`"${name}" is not a valid SQL identifier`);
  }
  return `"${name}"`;
}

// ---------------------------------------------------------------------------
// The description a builder hands over
// ---------------------------------------------------------------------------

export type FilterOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'ilike' | 'is' | 'in';

export interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}

export interface Order {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

export type QueryKind = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

export interface QuerySpec {
  table: string;
  kind: QueryKind;
  /** PostgREST-style select list. Absent on a write that returns nothing. */
  columns?: string;
  values?: Record<string, unknown> | Record<string, unknown>[];
  /** Conflict target for an upsert, as a comma-separated column list. */
  onConflict?: string;
  filters: Filter[];
  orders: Order[];
  limit?: number;
  /** Ask for a total row count alongside (or instead of) the rows. */
  count?: boolean;
  /** Count only — return no rows at all. */
  head?: boolean;
}

export interface CompiledQuery {
  text: string;
  values: unknown[];
}

/** Collects bind parameters so every caller shares one numbering. */
class Binder {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

// ---------------------------------------------------------------------------
// Select lists
// ---------------------------------------------------------------------------

interface ColumnField {
  kind: 'column';
  name: string;
  alias: string | null;
}

interface EmbedField {
  kind: 'embed';
  /** The key the rows come back under. */
  alias: string;
  /** Table name or foreign-key column written after the alias. */
  hint: string;
  children: Field[];
  /** `table(count)` asks for a count rather than the rows themselves. */
  countOnly: boolean;
}

type Field = ColumnField | EmbedField;

/**
 * Parses a select list.
 *
 * The grammar is small and entirely positional, so this is a hand-written
 * scanner rather than anything with a table in it:
 *
 *   name                     a column
 *   alias:name               a column under a different key
 *   table ( … )              related rows, related table named directly
 *   alias:column ( … )       related rows, reached through a named column
 *   table ( count )          how many related rows there are
 *   *                        every column
 */
export function parseSelect(source: string): Field[] {
  const fields: Field[] = [];
  let index = 0;

  const skipSpace = () => {
    while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
  };

  const readName = (): string => {
    skipSpace();
    const start = index;
    while (index < source.length && /[A-Za-z0-9_*]/.test(source[index] ?? '')) index += 1;
    const name = source.slice(start, index);
    if (name === '') {
      throw new QueryError(`Expected a column name at position ${start} of "${source}"`);
    }
    return name;
  };

  /** Everything between a matched pair of parentheses. */
  const readGroup = (): string => {
    // `index` sits on the opening paren.
    let depth = 0;
    const start = index + 1;
    while (index < source.length) {
      const char = source[index];
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          const inner = source.slice(start, index);
          index += 1;
          return inner;
        }
      }
      index += 1;
    }
    throw new QueryError(`Unbalanced parentheses in "${source}"`);
  };

  while (index < source.length) {
    skipSpace();
    if (index >= source.length) break;

    let alias: string | null = null;
    let name = readName();

    skipSpace();
    if (source[index] === ':') {
      index += 1;
      alias = name;
      name = readName();
      skipSpace();
    }

    if (source[index] === '(') {
      const inner = readGroup().trim();
      const countOnly = inner === 'count';
      fields.push({
        kind: 'embed',
        alias: alias ?? name,
        hint: name,
        children: countOnly ? [] : parseSelect(inner),
        countOnly,
      });
    } else {
      fields.push({ kind: 'column', name, alias });
    }

    skipSpace();
    if (source[index] === ',') index += 1;
  }

  return fields;
}

/**
 * Renders a parsed select list against one table.
 *
 * `depth` only exists to keep the table aliases of nested subqueries distinct,
 * so a three-level embed does not shadow its own parent.
 */
function renderFields(
  fields: Field[],
  table: string,
  tableAlias: string,
  binder: Binder,
  depth: number,
): string {
  if (fields.length === 0) return `${tableAlias}.*`;

  return fields
    .map((field) => renderField(field, table, tableAlias, binder, depth))
    .join(', ');
}

function renderField(
  field: Field,
  table: string,
  tableAlias: string,
  binder: Binder,
  depth: number,
): string {
  if (field.kind === 'column') {
    if (field.name === '*') return `${tableAlias}.*`;
    const column = `${tableAlias}.${ident(field.name)}`;
    return field.alias ? `${column} as ${ident(field.alias)}` : column;
  }

  const child = `t${depth + 1}`;
  const { target, column, direction } = resolveEmbed(table, field);

  if (direction === 'one') {
    // A related row, or null when there is none — the same shape the call
    // sites were written against.
    const inner = renderFields(field.children, target, child, binder, depth + 1);
    return (
      `(select to_jsonb(e) from (select ${inner} from public.${ident(target)} ${child} ` +
      `where ${child}.${ident('id')} = ${tableAlias}.${ident(column)}) e) as ${ident(field.alias)}`
    );
  }

  if (field.countOnly) {
    // PostgREST reports an embedded count as a one-element array, and the
    // pages that read it index into that, so keep the shape.
    return (
      `(select jsonb_build_array(jsonb_build_object('count', count(*))) ` +
      `from public.${ident(target)} ${child} ` +
      `where ${child}.${ident(column)} = ${tableAlias}.${ident('id')}) as ${ident(field.alias)}`
    );
  }

  // Related rows. Empty comes back as `[]` rather than null, again matching
  // what the call sites expect.
  const inner = renderFields(field.children, target, child, binder, depth + 1);
  return (
    `coalesce((select jsonb_agg(e) from (select ${inner} from public.${ident(target)} ${child} ` +
    `where ${child}.${ident(column)} = ${tableAlias}.${ident('id')}) e), '[]'::jsonb) ` +
    `as ${ident(field.alias)}`
  );
}

interface ResolvedEmbed {
  target: string;
  column: string;
  direction: 'one' | 'many';
}

/**
 * Works out what an embed actually refers to.
 *
 * `users:author_id ( … )` names the column outright. A bare `users ( … )` has
 * to be looked up: first as a foreign key on this table, then as one pointing
 * back at it. Anything ambiguous is refused rather than guessed at, because
 * quietly picking `owner_id` over `approved_by` would be a wrong answer that
 * still returns rows.
 */
function resolveEmbed(table: string, field: EmbedField): ResolvedEmbed {
  // `alias:author_id ( … )` — the hint names a foreign-key column outright.
  const named = FOREIGN_KEYS[table]?.[field.hint];
  if (named) return { target: named, column: field.hint, direction: 'one' };

  // `departments ( … )` — the hint names a table this one points at.
  const viaColumn = belongsToColumn(table, field.hint);
  if (viaColumn === 'ambiguous') {
    throw new QueryError(
      `"${field.hint}" is ambiguous on ${table}: name the foreign-key column, ` +
        'as in alias:column ( … )',
    );
  }
  if (viaColumn) return { target: field.hint, column: viaColumn, direction: 'one' };

  // `form_responses ( … )` — the hint names a table that points back at this one.
  const back = hasManyColumn(table, field.hint);
  if (back === 'ambiguous') {
    throw new QueryError(
      `${field.hint} points at ${table} more than once — embedding it is ambiguous`,
    );
  }
  if (back) return { target: field.hint, column: back, direction: 'many' };

  throw new QueryError(`No relationship between ${table} and "${field.hint}"`);
}

// ---------------------------------------------------------------------------
// Filters, ordering
// ---------------------------------------------------------------------------

function renderFilters(filters: Filter[], alias: string, binder: Binder): string {
  if (filters.length === 0) return '';

  const parts = filters.map((filter) => {
    const column = `${alias}.${ident(filter.column)}`;

    switch (filter.op) {
      case 'is':
        if (filter.value === null) return `${column} is null`;
        if (filter.value === true) return `${column} is true`;
        if (filter.value === false) return `${column} is false`;
        throw new QueryError('is() takes null, true or false');

      case 'in': {
        const list = filter.value as unknown[];
        // `= any($1)` rather than an expanded IN list: one bind parameter
        // whatever the length, and an empty array is still valid SQL.
        return `${column} = any(${binder.add(list)})`;
      }

      case 'eq':
        // `eq(col, null)` is a mistake worth catching — in SQL it matches
        // nothing at all, silently.
        if (filter.value === null) {
          throw new QueryError(`eq("${filter.column}", null) never matches — use is()`);
        }
        return `${column} = ${binder.add(filter.value)}`;

      case 'neq':
        return `${column} <> ${binder.add(filter.value)}`;
      case 'gt':
        return `${column} > ${binder.add(filter.value)}`;
      case 'gte':
        return `${column} >= ${binder.add(filter.value)}`;
      case 'lt':
        return `${column} < ${binder.add(filter.value)}`;
      case 'lte':
        return `${column} <= ${binder.add(filter.value)}`;
      case 'like':
        return `${column} like ${binder.add(filter.value)}`;
      case 'ilike':
        return `${column} ilike ${binder.add(filter.value)}`;
    }
  });

  return ` where ${parts.join(' and ')}`;
}

function renderOrder(orders: Order[], alias: string): string {
  if (orders.length === 0) return '';
  const parts = orders.map(
    (order) =>
      `${alias}.${ident(order.column)} ${order.ascending ? 'asc' : 'desc'} ` +
      `nulls ${order.nullsFirst ? 'first' : 'last'}`,
  );
  return ` order by ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

const ALIAS = 't0';

export function compile(spec: QuerySpec): CompiledQuery {
  const binder = new Binder();
  const text = render(spec, binder);
  return { text, values: binder.values };
}

function render(spec: QuerySpec, binder: Binder): string {
  switch (spec.kind) {
    case 'select':
      return renderSelect(spec, binder);
    case 'insert':
    case 'upsert':
      return renderInsert(spec, binder);
    case 'update':
      return renderUpdate(spec, binder);
    case 'delete':
      return renderDelete(spec, binder);
  }
}

function renderSelect(spec: QuerySpec, binder: Binder): string {
  const table = `public.${ident(spec.table)} ${ALIAS}`;

  if (spec.head) {
    return `select count(*)::bigint as "count" from ${table}${renderFilters(
      spec.filters,
      ALIAS,
      binder,
    )}`;
  }

  const fields = parseSelect(spec.columns ?? '*');
  const list = renderFields(fields, spec.table, ALIAS, binder, 0);

  // The count has to be taken before the limit, so it rides along as a window
  // function rather than as a second statement.
  const withCount = spec.count ? `${list}, count(*) over () as "__count"` : list;

  let text = `select ${withCount} from ${table}`;
  text += renderFilters(spec.filters, ALIAS, binder);
  text += renderOrder(spec.orders, ALIAS);
  if (spec.limit !== undefined) text += ` limit ${binder.add(spec.limit)}`;
  return text;
}

/** The columns written by an insert, unioned across every row. */
function insertColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

function renderInsert(spec: QuerySpec, binder: Binder): string {
  const rows = Array.isArray(spec.values) ? spec.values : [spec.values ?? {}];
  if (rows.length === 0) throw new QueryError('insert() was given no rows');

  const columns = insertColumns(rows);
  if (columns.length === 0) throw new QueryError('insert() was given no columns');

  const tuples = rows
    .map((row) => `(${columns.map((column) => binder.add(row[column] ?? null)).join(', ')})`)
    .join(', ');

  // The alias is what lets RETURNING share the field renderer with SELECT:
  // without it, `returning t0."id"` has no such range table and Postgres
  // refuses the statement.
  let text =
    `insert into public.${ident(spec.table)} as ${ALIAS} ` +
    `(${columns.map(ident).join(', ')}) values ${tuples}`;

  if (spec.kind === 'upsert') {
    const conflict = (spec.onConflict ?? 'id')
      .split(',')
      .map((column) => ident(column.trim()));

    // Everything except the conflict target is refreshed from the row that
    // was offered, which is what "insert or update" is taken to mean here.
    const updated = columns.filter(
      (column) => !conflict.includes(ident(column)),
    );

    text +=
      updated.length > 0
        ? ` on conflict (${conflict.join(', ')}) do update set ` +
          updated.map((column) => `${ident(column)} = excluded.${ident(column)}`).join(', ')
        : ` on conflict (${conflict.join(', ')}) do nothing`;
  }

  return text + returning(spec, binder);
}

function renderUpdate(spec: QuerySpec, binder: Binder): string {
  const values = (spec.values ?? {}) as Record<string, unknown>;
  const columns = Object.keys(values);
  if (columns.length === 0) throw new QueryError('update() was given no columns');

  const assignments = columns
    .map((column) => `${ident(column)} = ${binder.add(values[column] ?? null)}`)
    .join(', ');

  return (
    `update public.${ident(spec.table)} ${ALIAS} set ${assignments}` +
    renderFilters(spec.filters, ALIAS, binder) +
    returning(spec, binder)
  );
}

function renderDelete(spec: QuerySpec, binder: Binder): string {
  return (
    `delete from public.${ident(spec.table)} ${ALIAS}` +
    renderFilters(spec.filters, ALIAS, binder) +
    returning(spec, binder)
  );
}

/**
 * `returning` for a write that asked for its rows back.
 *
 * Every write statement above names its table `t0`, so the affected row is
 * reachable under the same alias a SELECT uses and the field renderer works
 * here unchanged — embeds included.
 */
function returning(spec: QuerySpec, binder: Binder): string {
  if (spec.columns === undefined) return '';
  const fields = parseSelect(spec.columns);
  return ` returning ${renderFields(fields, spec.table, ALIAS, binder, 0)}`;
}
