#!/usr/bin/env node
/**
 * Local development API.
 *
 * Speaks enough of the PostgREST and Supabase Storage wire protocols for this
 * app to run against a plain local Postgres, so you can develop — and see the
 * whole portal — without signing up for anything.
 *
 * It is NOT a PostgREST replacement. It implements exactly the query shapes
 * this codebase uses, and it is only ever meant for `npm run dev:local`.
 * Production runs against real Supabase, where the same SQL and the same RLS
 * policies apply.
 *
 * Crucially it does apply RLS: every request runs inside a transaction that
 * sets `role` and `request.jwt.claims` exactly as PostgREST would, so the
 * policies you are developing against are the real ones.
 */
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import pg from 'pg';

// PostgREST returns `date` and `time` as bare strings ("2027-03-20", "07:00:00").
// node-pg would otherwise hand back JS Date objects, which serialise to full
// ISO timestamps and would make this shim disagree with production.
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1083, (v) => v); // time
pg.types.setTypeParser(1114, (v) => v); // timestamp without time zone

const PORT = Number(process.env.DEV_API_PORT ?? 54321);
const DATABASE_URL =
  process.env.DEV_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/hackathon_studio';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'local-service-role-key';
const STORAGE_DIR = process.env.DEV_STORAGE_DIR ?? '.dev-storage';

mkdirSync(STORAGE_DIR, { recursive: true });

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

// ---------------------------------------------------------------------------
// Schema introspection — needed to resolve embedded selects to real joins.
// ---------------------------------------------------------------------------
/** @type {Map<string, Map<string, {table: string, column: string}>>} fk by table.column */
const fkByColumn = new Map();
/** @type {Map<string, Array<{table: string, column: string}>>} reverse FKs pointing at a table */
const fkToTable = new Map();

async function introspect() {
  const { rows } = await pool.query(`
    select
      tc.table_name        as src_table,
      kcu.column_name      as src_column,
      ccu.table_name       as dst_table,
      ccu.column_name      as dst_column
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
  `);

  for (const r of rows) {
    if (!fkByColumn.has(r.src_table)) fkByColumn.set(r.src_table, new Map());
    fkByColumn.get(r.src_table).set(r.src_column, { table: r.dst_table, column: r.dst_column });

    if (!fkToTable.has(r.dst_table)) fkToTable.set(r.dst_table, []);
    fkToTable.get(r.dst_table).push({ table: r.src_table, column: r.src_column });
  }
  console.log(`[dev-api] introspected ${rows.length} foreign keys`);
}

// ---------------------------------------------------------------------------
// select= parsing
//
// Handles the three shapes this app uses:
//   plain columns                 id, title, status
//   many-to-one via a FK column   users:owner_id ( nickname, name )
//   one-to-many with nesting      assignment_assignees ( user_id, users ( ... ) )
//   aggregate                     form_responses ( count )
// ---------------------------------------------------------------------------
function parseSelect(input) {
  const spec = { columns: [], embeds: [] };
  if (!input || input === '*') {
    spec.columns.push('*');
    return spec;
  }

  for (const part of splitTopLevel(input)) {
    const open = part.indexOf('(');
    if (open === -1) {
      spec.columns.push(part.trim());
      continue;
    }

    const head = part.slice(0, open).trim();
    const body = part.slice(open + 1, part.lastIndexOf(')'));
    const [aliasOrName, maybeName] = head.split(':').map((s) => s.trim());
    const alias = maybeName ? aliasOrName : aliasOrName;
    const target = maybeName ? maybeName : aliasOrName;

    spec.embeds.push({ alias, target, select: parseSelect(body) });
  }
  return spec;
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(input) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
const OPERATORS = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=',
  like: 'like', ilike: 'ilike',
};

function buildFilters(table, params, values) {
  const clauses = [];

  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;

    if (key === 'or') {
      const inner = raw.replace(/^\(|\)$/g, '');
      const parts = splitTopLevel(inner).map((p) => {
        const [col, op, ...rest] = p.trim().split('.');
        return renderCondition(col, op, rest.join('.'), values);
      });
      clauses.push(`(${parts.join(' or ')})`);
      continue;
    }

    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    clauses.push(renderCondition(key, op, value, values));
  }

  return clauses;
}

function renderCondition(column, op, value, values) {
  const col = `"${column}"`;

  if (op === 'is') {
    if (value === 'null') return `${col} is null`;
    if (value === 'not.null') return `${col} is not null`;
    return `${col} is ${value}`;
  }
  if (op === 'not') {
    // not.is.null
    const [innerOp, ...rest] = value.split('.');
    return `not (${renderCondition(column, innerOp, rest.join('.'), values)})`;
  }
  if (op === 'in') {
    const list = value.replace(/^\(|\)$/g, '').split(',').map((v) => stripQuotes(v));
    if (list.length === 0) return 'false';
    const placeholders = list.map((v) => {
      values.push(v);
      return `$${values.length}`;
    });
    return `${col} in (${placeholders.join(',')})`;
  }

  const sqlOp = OPERATORS[op];
  if (!sqlOp) throw new Error(`Unsupported operator: ${op}`);
  values.push(stripQuotes(value));
  return `${col} ${sqlOp} $${values.length}`;
}

function stripQuotes(v) {
  const s = decodeURIComponent(v);
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function buildOrder(params) {
  const order = params.get('order');
  if (!order) return '';
  const parts = order.split(',').map((clause) => {
    const [col, ...mods] = clause.split('.');
    const dir = mods.includes('desc') ? 'desc' : 'asc';
    const nulls = mods.includes('nullsfirst')
      ? ' nulls first'
      : mods.includes('nullslast')
        ? ' nulls last'
        : '';
    return `"${col}" ${dir}${nulls}`;
  });
  return ` order by ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Embed resolution — one extra query per embed, stitched in JS.
// ---------------------------------------------------------------------------
async function attachEmbeds(client, table, rows, embeds) {
  if (rows.length === 0 || embeds.length === 0) return;

  for (const embed of embeds) {
    // An embed target names either a FK column on this table
    // (`users:owner_id(...)`) or, when nested, the target table itself
    // (`assignment_assignees(user_id, users(...))` — where `users` resolves
    // through the single FK from assignment_assignees to users).
    let fkColumn = embed.target;
    let fk = fkByColumn.get(table)?.get(embed.target);

    if (!fk) {
      const byTable = [...(fkByColumn.get(table)?.entries() ?? [])]
        .filter(([, target]) => target.table === embed.target);
      if (byTable.length === 1) {
        [fkColumn, fk] = byTable[0];
      }
    }

    if (fk) {
      // many-to-one: rows[].<fkColumn> is the FK value
      const ids = [...new Set(rows.map((r) => r[fkColumn]).filter((v) => v != null))];
      const key = embed.alias;

      if (ids.length === 0) {
        for (const row of rows) row[key] = null;
        continue;
      }

      const cols = embed.select.columns.includes('*')
        ? '*'
        : [...new Set([...embed.select.columns, fk.column])].map((c) => `"${c}"`).join(',');
      const { rows: related } = await client.query(
        `select ${cols} from "${fk.table}" where "${fk.column}" = any($1)`,
        [ids],
      );
      const byId = new Map(related.map((r) => [String(r[fk.column]), r]));

      for (const row of rows) {
        const match = byId.get(String(row[fkColumn]));
        row[key] = match ? projectRow(match, embed.select.columns) : null;
      }
      await attachEmbeds(client, fk.table, related, embed.select.embeds);
      continue;
    }

    // one-to-many: embed.target is a table with a FK back to `table`
    const back = fkToTable.get(table)?.find((f) => f.table === embed.target);
    if (!back) {
      for (const row of rows) row[embed.alias] = null;
      continue;
    }

    const pkValues = rows.map((r) => r.id).filter((v) => v != null);
    const isCountOnly =
      embed.select.columns.length === 1 && embed.select.columns[0] === 'count';

    if (isCountOnly) {
      const { rows: counts } = await client.query(
        `select "${back.column}" as parent, count(*)::int as count
         from "${back.table}" where "${back.column}" = any($1) group by 1`,
        [pkValues],
      );
      const byParent = new Map(counts.map((c) => [String(c.parent), c.count]));
      for (const row of rows) {
        row[embed.alias] = [{ count: byParent.get(String(row.id)) ?? 0 }];
      }
      continue;
    }

    const cols = embed.select.columns.includes('*')
      ? '*'
      : [...new Set([...embed.select.columns, back.column])].map((c) => `"${c}"`).join(',');
    const { rows: children } = await client.query(
      `select ${cols} from "${back.table}" where "${back.column}" = any($1)`,
      [pkValues],
    );

    await attachEmbeds(client, back.table, children, embed.select.embeds);

    const grouped = new Map();
    for (const child of children) {
      const parent = String(child[back.column]);
      if (!grouped.has(parent)) grouped.set(parent, []);
      grouped.get(parent).push(child);
    }
    for (const row of rows) row[embed.alias] = grouped.get(String(row.id)) ?? [];
  }
}

function projectRow(row, columns) {
  if (columns.includes('*')) return row;
  const out = {};
  for (const c of columns) out[c] = row[c] ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// Auth — mirror what PostgREST does with the bearer token.
// ---------------------------------------------------------------------------
function authFor(req) {
  const header = req.headers.authorization ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();

  if (!token || token === SERVICE_ROLE_KEY) {
    // Service role: bypasses RLS, same as production.
    return { role: 'service', claims: null };
  }

  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role === 'authenticated' && payload.sub) {
      return { role: 'authenticated', claims: payload };
    }
  } catch {
    // Falls through to anon — an unparseable token is not a signed-in user.
  }
  return { role: 'anon', claims: { role: 'anon' } };
}

async function withSession(auth, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (auth.role === 'service') {
      // superuser connection already bypasses RLS
      await client.query(`select set_config('request.jwt.claims', '', true)`);
    } else {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(auth.claims),
      ]);
      await client.query(`set local role ${auth.role}`);
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// REST handler
// ---------------------------------------------------------------------------
async function handleRest(req, res, url, body) {
  const table = url.pathname.replace('/rest/v1/', '').split('/')[0];
  if (!table) return send(res, 404, { message: 'No table' });

  const params = [...url.searchParams.entries()];
  const auth = authFor(req);
  const prefer = String(req.headers.prefer ?? '');
  const wantsSingle = String(req.headers.accept ?? '').includes('pgrst.object');
  const wantsCount = prefer.includes('count=exact');
  const returnsRepresentation = prefer.includes('return=representation');

  const result = await withSession(auth, async (client) => {
    const selectSpec = parseSelect(url.searchParams.get('select') ?? '*');

    if (req.method === 'GET' || req.method === 'HEAD') {
      const values = [];
      const where = buildFilters(table, params, values);
      const whereSql = where.length ? ` where ${where.join(' and ')}` : '';

      let count = null;
      if (wantsCount) {
        const { rows } = await client.query(
          `select count(*)::int as c from "${table}"${whereSql}`, values,
        );
        count = rows[0].c;
      }
      if (req.method === 'HEAD') return { rows: [], count };

      // An embed target is only a real column when it names a FK on this
      // table (many-to-one). A one-to-many embed names another table, which
      // must not end up in the SELECT list.
      const embedColumns = selectSpec.embeds.flatMap((e) => {
        if (fkByColumn.get(table)?.has(e.target)) return [e.target];
        const byTable = [...(fkByColumn.get(table)?.entries() ?? [])]
          .filter(([, target]) => target.table === e.target);
        return byTable.length === 1 ? [byTable[0][0]] : [];
      });

      const cols = selectSpec.columns.includes('*')
        ? '*'
        : [...new Set([...selectSpec.columns, 'id', ...embedColumns])]
            .filter((c) => c && !c.includes('('))
            .map((c) => `"${c}"`).join(',');

      const limit = url.searchParams.get('limit');
      const sql =
        `select ${cols || '*'} from "${table}"${whereSql}${buildOrder(url.searchParams)}` +
        (limit ? ` limit ${Number(limit)}` : '');

      const { rows } = await client.query(sql, values);
      await attachEmbeds(client, table, rows, selectSpec.embeds);
      return { rows, count };
    }

    if (req.method === 'POST') {
      const payload = Array.isArray(body) ? body : [body];
      if (payload.length === 0) return { rows: [], count: null };

      const onConflict = url.searchParams.get('on_conflict');
      const merge = prefer.includes('resolution=merge-duplicates');
      const columns = [...new Set(payload.flatMap((r) => Object.keys(r)))];
      const values = [];
      const tuples = payload.map((row) => {
        const placeholders = columns.map((c) => {
          values.push(row[c] === undefined ? null : normalise(row[c]));
          return `$${values.length}`;
        });
        return `(${placeholders.join(',')})`;
      });

      let conflictSql = '';
      if (merge && onConflict) {
        const target = onConflict.split(',').map((c) => `"${c.trim()}"`).join(',');
        const updates = columns
          .filter((c) => !onConflict.split(',').map((x) => x.trim()).includes(c))
          .map((c) => `"${c}" = excluded."${c}"`);
        conflictSql = updates.length
          ? ` on conflict (${target}) do update set ${updates.join(', ')}`
          : ` on conflict (${target}) do nothing`;
      } else if (merge) {
        conflictSql = ' on conflict do nothing';
      }

      const sql =
        `insert into "${table}" (${columns.map((c) => `"${c}"`).join(',')}) ` +
        `values ${tuples.join(',')}${conflictSql} returning *`;
      const { rows } = await client.query(sql, values);
      await attachEmbeds(client, table, rows, selectSpec.embeds);
      return { rows, count: null };
    }

    if (req.method === 'PATCH') {
      const values = [];
      const sets = Object.keys(body).map((c) => {
        values.push(normalise(body[c]));
        return `"${c}" = $${values.length}`;
      });
      const where = buildFilters(table, params, values);
      const whereSql = where.length ? ` where ${where.join(' and ')}` : '';
      const sql = `update "${table}" set ${sets.join(', ')}${whereSql} returning *`;
      const { rows } = await client.query(sql, values);
      await attachEmbeds(client, table, rows, selectSpec.embeds);
      return { rows, count: null };
    }

    if (req.method === 'DELETE') {
      const values = [];
      const where = buildFilters(table, params, values);
      const whereSql = where.length ? ` where ${where.join(' and ')}` : '';
      const { rows } = await client.query(
        `delete from "${table}"${whereSql} returning *`, values,
      );
      return { rows, count: null };
    }

    throw new Error(`Unsupported method ${req.method}`);
  });

  const headers = {};
  if (result.count !== null && result.count !== undefined) {
    headers['content-range'] = `0-${Math.max(result.count - 1, 0)}/${result.count}`;
  }

  if (req.method === 'HEAD') return send(res, 200, null, headers);

  if (wantsSingle) {
    if (result.rows.length === 0) {
      // supabase-js maybeSingle() treats PGRST116 as "no rows", not an error.
      return send(res, 406, {
        code: 'PGRST116', message: 'No rows found', details: null, hint: null,
      }, headers);
    }
    return send(res, 200, result.rows[0], headers);
  }

  if ((req.method === 'POST' || req.method === 'PATCH') && !returnsRepresentation) {
    return send(res, 201, null, headers);
  }

  return send(res, 200, result.rows, headers);
}

function normalise(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
  return value;
}

// ---------------------------------------------------------------------------
// Storage — files on disk, public URLs served straight back.
// ---------------------------------------------------------------------------
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4',
};

async function handleStorage(req, res, url, rawBody) {
  const path = url.pathname.replace('/storage/v1/', '');

  if (path.startsWith('object/public/')) {
    const key = decodeURIComponent(path.replace('object/public/', ''));
    const file = join(STORAGE_DIR, key.replace(/\.\./g, ''));
    if (!existsSync(file)) return send(res, 404, { message: 'Not found' });
    const data = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    return res.end(data);
  }

  if (path.startsWith('object/list/') || path.startsWith('object/')) {
    const rest = path.replace(/^object\/(list\/)?/, '');
    const bucket = rest.split('/')[0];
    const key = rest.slice(bucket.length + 1);

    if (req.method === 'POST' && path.startsWith('object/list/')) {
      const dir = join(STORAGE_DIR, bucket);
      if (!existsSync(dir)) return send(res, 200, []);
      const entries = walk(dir).map((f) => ({
        name: f.replace(`${dir}/`, ''),
        id: randomUUID(),
        updated_at: statSync(f).mtime.toISOString(),
        metadata: { size: statSync(f).size },
      }));
      return send(res, 200, entries);
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      const file = join(STORAGE_DIR, bucket, decodeURIComponent(key).replace(/\.\./g, ''));
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, rawBody);
      return send(res, 200, { Key: `${bucket}/${key}` });
    }

    if (req.method === 'DELETE') {
      let payload = {};
      try { payload = JSON.parse(rawBody.toString('utf8') || '{}'); } catch { /* ignore */ }
      for (const name of payload.prefixes ?? []) {
        const file = join(STORAGE_DIR, bucket, String(name).replace(/\.\./g, ''));
        if (existsSync(file)) unlinkSync(file);
      }
      return send(res, 200, []);
    }
  }

  return send(res, 404, { message: 'Unsupported storage route' });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
function send(res, status, payload, headers = {}) {
  const base = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'content-range',
    ...headers,
  };
  if (payload === null || payload === undefined) {
    res.writeHead(status, base);
    return res.end();
  }
  res.writeHead(status, { ...base, 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'OPTIONS') return send(res, 204, null);

    try {
      if (url.pathname.startsWith('/rest/v1/')) {
        let body = null;
        if (raw.length > 0) {
          try { body = JSON.parse(raw.toString('utf8')); } catch { body = null; }
        }
        return await handleRest(req, res, url, body);
      }
      if (url.pathname.startsWith('/storage/v1/')) {
        return await handleStorage(req, res, url, raw);
      }
      return send(res, 404, { message: 'Not found' });
    } catch (error) {
      // Surface the Postgres error the way PostgREST does, so the app's
      // friendly() error mapping behaves the same as in production.
      const message = error?.message ?? String(error);
      console.error(`[dev-api] ${req.method} ${url.pathname} — ${message}`);
      const status = /row-level security|permission denied/i.test(message) ? 403 : 400;
      return send(res, status, {
        message,
        code: error?.code ?? null,
        details: error?.detail ?? null,
        hint: error?.hint ?? null,
      });
    }
  });
});

await introspect();
server.listen(PORT, () => {
  console.log(`[dev-api] listening on http://localhost:${PORT}`);
  console.log(`[dev-api] database ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`);
  console.log(`[dev-api] storage  ${STORAGE_DIR}`);
});
