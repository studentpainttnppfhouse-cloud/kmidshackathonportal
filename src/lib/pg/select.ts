/**
 * The PostgREST `select=` grammar, as much of it as this app actually writes.
 *
 * Moving off Supabase meant giving up PostgREST, but not the 150-odd call
 * sites written against it. Parsing the same select strings here — rather than
 * rewriting every query by hand — keeps each of those call sites, and the row
 * shapes the screens already destructure, exactly as they were. A hand
 * rewrite would have had to get all 150 right in one pass, with a dropped
 * filter looking identical to a working query.
 *
 * Supported: plain columns, `*`, an aliased embed (`owner:owner_id ( ... )`),
 * a bare embed (`users ( ... )`), nesting, and the `(count)` aggregate.
 * Anything else throws, loudly, at the call site rather than silently
 * returning the wrong rows.
 */

export interface SelectNode {
  /** Plain columns on this relation. `*` is kept verbatim. */
  columns: string[];
  embeds: Embed[];
}

export interface Embed {
  /** The key this appears under in the result row. */
  alias: string;
  /**
   * What to resolve the relationship through — either a foreign key column on
   * the parent (`owner_id`) or the name of the related table (`users`).
   */
  hint: string;
  /** `form_responses(count)` — an aggregate rather than embedded rows. */
  isCount: boolean;
  node: SelectNode;
}

class Cursor {
  constructor(readonly text: string, public i = 0) {}

  get done(): boolean {
    return this.i >= this.text.length;
  }

  peek(): string {
    return this.text[this.i] ?? '';
  }

  skipSpace(): void {
    while (!this.done && /\s/.test(this.peek())) this.i += 1;
  }
}

const IDENT = /[A-Za-z0-9_*]/;

function readIdent(c: Cursor): string {
  const start = c.i;
  while (!c.done && IDENT.test(c.peek())) c.i += 1;
  if (c.i === start) {
    throw new Error(`Bad select at position ${c.i}: expected a column name in "${c.text}"`);
  }
  return c.text.slice(start, c.i);
}

function parseNode(c: Cursor, depth: number): SelectNode {
  if (depth > 4) throw new Error(`Select nested too deeply in "${c.text}"`);

  const node: SelectNode = { columns: [], embeds: [] };

  for (;;) {
    c.skipSpace();
    if (c.done || c.peek() === ')') break;

    const first = readIdent(c);
    c.skipSpace();

    // `alias:hint ( ... )` — the alias names the output key, the hint says
    // which relationship to travel.
    let alias = first;
    let hint = first;
    if (c.peek() === ':') {
      c.i += 1;
      c.skipSpace();
      hint = readIdent(c);
      c.skipSpace();
    }

    if (c.peek() === '(') {
      c.i += 1;
      const inner = parseNode(c, depth + 1);
      c.skipSpace();
      if (c.peek() !== ')') {
        throw new Error(`Unclosed embed for "${alias}" in "${c.text}"`);
      }
      c.i += 1;

      const isCount =
        inner.embeds.length === 0 && inner.columns.length === 1 && inner.columns[0] === 'count';

      node.embeds.push({ alias, hint, isCount, node: isCount ? { columns: [], embeds: [] } : inner });
    } else {
      if (alias !== hint) {
        // `alias:column` without parentheses is a renamed column. Nothing in
        // this app uses it; rejecting is better than quietly dropping it.
        throw new Error(`Column aliases are not supported ("${alias}:${hint}" in "${c.text}")`);
      }
      node.columns.push(alias);
    }

    c.skipSpace();
    if (c.peek() === ',') {
      c.i += 1;
      continue;
    }
    if (c.done || c.peek() === ')') break;

    throw new Error(`Bad select at position ${c.i}: unexpected "${c.peek()}" in "${c.text}"`);
  }

  return node;
}

export function parseSelect(select: string): SelectNode {
  const c = new Cursor(select);
  const node = parseNode(c, 0);
  c.skipSpace();
  if (!c.done) {
    throw new Error(`Bad select: trailing "${c.text.slice(c.i)}" in "${c.text}"`);
  }
  if (node.columns.length === 0 && node.embeds.length === 0) {
    throw new Error('Bad select: nothing selected');
  }
  return node;
}
