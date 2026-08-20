#!/usr/bin/env node
/**
 * `npm run db:setup`
 *
 * Takes a brand new Supabase project to a working portal in one command:
 *
 *   1. checks your environment variables are all present and look right
 *   2. applies every migration, in order, tracking what has already run
 *   3. creates the `files` storage bucket
 *   4. optionally loads the demo data  (--seed)
 *   5. tells you which account is the Owner
 *
 * Needs SUPABASE_DB_URL — the direct Postgres connection string from
 * Supabase, under Settings > Database > Connection string > URI.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS = 'supabase/migrations';
const SEED = 'supabase/seed/demo_data.sql';
const BUCKET = 'files';

const args = new Set(process.argv.slice(2));
const withSeed = args.has('--seed');

const c = {
  pink: (s) => `\x1b[35m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function step(n, msg) { console.log(`\n${c.pink(`[${n}/4]`)} ${c.bold(msg)}`); }
function ok(msg) { console.log(`      ${c.green('✓')} ${msg}`); }
function info(msg) { console.log(`      ${c.dim(msg)}`); }

function loadEnvLocal() {
  // Read .env.local ourselves — this script runs outside Next, which is what
  // normally does this.
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

function fail(message, hint) {
  console.error(`\n${c.red('✗')} ${message}`);
  if (hint) console.error(`  ${c.dim(hint)}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
loadEnvLocal();

console.log(c.bold('\nHackathon Studio — Supabase setup\n'));

step(1, 'Checking your environment');

const required = {
  NEXT_PUBLIC_SUPABASE_URL: 'Settings > API > Project URL',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'Settings > API > anon public key',
  SUPABASE_SERVICE_ROLE_KEY: 'Settings > API > service_role key',
  SUPABASE_JWT_SECRET: 'Settings > API > JWT Settings > JWT Secret',
  OWNER_EMAIL: 'the email address that should be the first Owner',
  SUPABASE_DB_URL: 'Settings > Database > Connection string > URI',
};

const missing = Object.entries(required).filter(([key]) => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n${c.red('Missing environment variables:')}\n`);
  for (const [key, where] of missing) console.error(`  ${c.bold(key)}\n    ${c.dim(where)}`);
  console.error(`\nAdd them to ${c.bold('.env.local')} — copy ${c.bold('.env.example')} to start.\n`);
  process.exit(1);
}

if (process.env.SUPABASE_JWT_SECRET.length < 16) {
  fail('SUPABASE_JWT_SECRET looks too short.', 'Copy the whole value from Settings > API > JWT Settings.');
}
if (!process.env.SUPABASE_DB_URL.startsWith('postgres')) {
  fail('SUPABASE_DB_URL does not look like a Postgres URI.', 'It should start with postgresql://');
}
ok('all variables present');

if (!process.env.OWNER_BACKUP_EMAIL) {
  info('OWNER_BACKUP_EMAIL is not set — you will have only one Owner.');
  info('The brief asks for two, so one graduating student is not a single point of failure.');
}

// ---------------------------------------------------------------------------
step(2, 'Applying migrations');

/**
 * Supabase requires TLS; a local Postgres almost never offers it. Decide from
 * the host rather than assuming, so `npm run db:setup` also works against a
 * local database or a unix socket.
 */
function needsSsl(connectionString) {
  if (/[?&]host=\//.test(connectionString)) return false; // unix socket
  try {
    const { hostname } = new URL(connectionString);
    return !['localhost', '127.0.0.1', '::1', ''].includes(hostname);
  } catch {
    return true;
  }
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: needsSsl(process.env.SUPABASE_DB_URL) ? { rejectUnauthorized: false } : false,
});

try {
  await client.connect();
} catch (error) {
  fail(`Could not connect to the database: ${error.message}`,
       'Check SUPABASE_DB_URL, and that your IP is allowed under Settings > Database.');
}
ok('connected');

await client.query(`
  create table if not exists public._migrations (
    name text primary key, applied_at timestamptz not null default now()
  )
`);

const applied = new Set(
  (await client.query('select name from public._migrations')).rows.map((r) => r.name),
);
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
let ran = 0;

for (const file of files) {
  if (applied.has(file)) {
    info(`skipping ${file} (already applied)`);
    continue;
  }
  process.stdout.write(`      running ${file} … `);
  try {
    await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
    await client.query('insert into public._migrations (name) values ($1)', [file]);
    console.log(c.green('ok'));
    ran += 1;
  } catch (error) {
    console.log(c.red('failed'));
    fail(`${file}: ${error.message}`,
         'Nothing after this point ran. Fix the error and run setup again — it resumes where it stopped.');
  }
}
ok(ran === 0 ? 'schema already up to date' : `${ran} migration(s) applied`);

// ---------------------------------------------------------------------------
step(3, 'Creating the storage bucket');

const storageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/storage/v1/bucket`;
const res = await fetch(storageUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
  body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
}).catch((error) => ({ ok: false, statusText: error.message, json: async () => ({}) }));

if (res.ok) {
  ok(`bucket "${BUCKET}" created (public)`);
} else {
  const body = await res.json().catch(() => ({}));
  const already = /already exists|Duplicate/i.test(JSON.stringify(body));
  if (already) ok(`bucket "${BUCKET}" already exists`);
  else info(`could not create the bucket automatically — make it by hand in Storage, named "${BUCKET}", public. (${body.message ?? res.statusText})`);
}

// ---------------------------------------------------------------------------
step(4, 'Finishing up');

if (withSeed) {
  const { rows } = await client.query('select count(*)::int as n from public.users');
  if (rows[0].n > 0) {
    info('users already exist — skipping the demo data.');
  } else if (existsSync(SEED)) {
    await client.query(readFileSync(SEED, 'utf8'));
    ok('demo data loaded');
  }
} else {
  info('run again with --seed to load demo content.');
}

const { rows: deptRows } = await client.query('select count(*)::int as n from public.departments');
ok(`${deptRows[0].n} departments ready`);

await client.end();

console.log(`\n${c.green(c.bold('Done.'))}`);
console.log(`\nStart the app:      ${c.bold('npm run dev')}`);
console.log(`Sign in as:         ${c.bold(process.env.OWNER_EMAIL)}  ${c.dim('(no password — email only)')}`);
if (process.env.OWNER_BACKUP_EMAIL) {
  console.log(`Second Owner:       ${c.bold(process.env.OWNER_BACKUP_EMAIL)}`);
}
console.log(`\nThen invite the rest of the team from the Owner Console.\n`);
