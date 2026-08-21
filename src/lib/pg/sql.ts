/**
 * Turning a parsed select into SQL.
 *
 * Embeds become correlated subqueries that build JSON inline, so one round
 * trip returns the same nested shape PostgREST did. Doing the nesting in the
 * database also means the embedded tables are read inside the same RLS
 * transaction as the parent — an embedded row a user may not see is filtered
 * by its own policies, exactly as before.
 */
import type { Embed, SelectNode } from './select';
import { resolveRelationship } from './relationships';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

/** Identifiers are code-authored, never user input, but check anyway. */
export function ident(name: string): string {
  if (name === '*') return '*';
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe identifier: "${name}"`);
  return `"${name}"`;
}

/** Hands out t0, t1, t2… so correlated subqueries can refer to their parent. */
export class AliasCounter {
  private n = 0;
  next(): string {
    this.n += 1;
    return `t${this.n}`;
  }
}

function embedExpression(
  parentTable: string,
  parentAlias: string,
  embed: Embed,
  counter: AliasCounter,
): string {
  const rel = resolveRelationship(parentTable, embed.hint);
  const alias = counter.next();
  const join =
    `${ident(alias)}.${ident(rel.foreignColumn)} = ${ident(parentAlias)}.${ident(rel.localColumn)}`;

  if (embed.isCount) {
    // PostgREST reports `table(count)` as a one-element array of objects, and
    // the screens read it as `x[0].count` — keep that shape.
    return (
      `(select jsonb_build_array(jsonb_build_object('count', count(*))) ` +
      `from ${ident(rel.table)} ${ident(alias)} where ${join}) as ${ident(embed.alias)}`
    );
  }

  const inner = selectList(rel.table, alias, embed.node, counter).join(', ');
  const subquery = `select ${inner} from ${ident(rel.table)} ${ident(alias)} where ${join}`;

  if (rel.kind === 'one') {
    // A missing row gives SQL NULL, which is what PostgREST returns too.
    return `(select to_jsonb(e.*) from (${subquery} limit 1) e) as ${ident(embed.alias)}`;
  }
  // jsonb_agg over no rows is NULL; PostgREST returns an empty array.
  return (
    `coalesce((select jsonb_agg(to_jsonb(e.*)) from (${subquery}) e), '[]'::jsonb) ` +
    `as ${ident(embed.alias)}`
  );
}

/** The comma-separated expressions for one relation's select. */
export function selectList(
  table: string,
  alias: string,
  node: SelectNode,
  counter: AliasCounter,
): string[] {
  const parts = node.columns.map((column) =>
    column === '*' ? `${ident(alias)}.*` : `${ident(alias)}.${ident(column)}`,
  );
  for (const embed of node.embeds) {
    parts.push(embedExpression(table, alias, embed, counter));
  }
  return parts;
}
