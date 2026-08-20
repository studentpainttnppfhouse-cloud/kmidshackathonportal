#!/usr/bin/env node
/**
 * `npm run db:setup`
 *
 * Takes an empty PostgreSQL database to a working portal in one command:
 *
 *   1. connects, the same way the app does
 *   2. creates the three roles the RLS policies are written against
 *   3. applies every migration, in order, tracking what has already run
 *   4. optionally loads the demo data  (--seed)
 *   5. tells you which account is the Owner
 *
 * Flags:
 *   --check   connect and report, change nothing
 *   --seed    load db/seed/demo_data.sql into an empty database
 *
 * Safe to run repeatedly: migrations already applied are skipped, and the seed
 * refuses to touch a database that already has users in it.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS = 'db/migrations';
const SEED = 'db/seed/demo_data.sql';
const CA_BUNDLE = 'certs/rds-global-bundle.pem';

/**
 * The roles every policy in db/migrations is written against.
 *
 * The app connects as one user and switches role per request — see
 * `asUser()` in src/lib/db/client.ts — so these have to exist before the
 * first policy is created.
 */
const ROLES = ['anon', 'authenticated', 'service_role'];

/** The same names src/lib/env.ts accepts, so one setting serves both. */
const URL_ALIASES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'RDS_DATABASE_URL',
  'PG_CONNECTION_STRING',
];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const withSeed = args.has('--seed');

const c = {
  pink: (s) => `\x1b[35m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const TOTAL_STEPS = checkOnly ? 1 : 4;
function step(n, msg) { console.log(`\n${c.pink(`[${n}/${TOTAL_STEPS}]`)} ${c.bold(msg)}`); }
function ok(msg) { console.log(`      ${c.green('✓')} ${msg}`); }
function info(msg) { console.log(`      ${c.dim(msg)}`); }

function fail(message, hint) {
  console.error(`\n${c.red('✗')} ${message}`);
  if (hint) console.error(`  ${c.dim(hint)}`);
  process.exit(1);
}

function loadEnvLocal() {
  // This script runs outside Next, which is what normally reads .env.local.
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
    }
  }
}

function resolveUrl() {
  for (const name of URL_ALIASES) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  fail(
    'DATABASE_URL is not set.',
    `Put it in .env.local, or export it. Also accepted as: ${URL_ALIASES.slice(1).join(', ')}`,
  );
}

/**
 * A managed database requires TLS; a Postgres on your own machine almost never
 * offers it. Decide from the host rather than from a flag someone has to
 * remember — src/lib/db/pool.ts makes the same call.
 */
function isLocal(host) {
  return ['localhost', '127.0.0.1', '::1', ''].includes(host);
}

function sslFor(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    fail(`"${url}" is not a valid connection URI.`, 'It should look like postgresql://user:password@host:5432/dbname');
  }
  if (isLocal(host) || /[?&]sslmode=disable\b/.test(url)) return false;

  if (!existsSync(CA_BUNDLE)) {
    fail(
      `${CA_BUNDLE} is missing.`,
      'Download it: curl -o certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem',
    );
  }
  return { ca: readFileSync(CA_BUNDLE, 'utf8'), rejectUnauthorized: true };
}

async function connect(url) {
  const client = new pg.Client({
    connectionString: url,
    ssl: sslFor(url),
    connectionTimeoutMillis: 15_000,
  });

  try {
    await client.connect();
  } catch (error) {
    const m = error.message.toLowerCase();
    let hint = 'Check the host, the database name and the user in DATABASE_URL.';
    if (m.includes('timeout') || m.includes('etimedout') || m.includes('econnrefused')) {
      hint = 'The server did not answer. On RDS, check the instance is publicly accessible and that its security group allows inbound TCP 5432 from your IP.';
    } else if (m.includes('pg_hba') || m.includes('password authentication failed')) {
      hint = 'The credentials were rejected. If the password contains punctuation, it has to be URL-encoded inside the URI.';
    } else if (m.includes('certificate')) {
      hint = 'TLS verification failed — certs/rds-global-bundle.pem may be out of date.';
    }
    fail(`Could not connect: ${error.message}`, hint);
  }
  return client;
}

/** The URI with its password blanked out, for printing. */
function describe(url) {
  try {
    const u = new URL(url);
    return `${u.username || '(default user)'}@${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(unparseable URI)';
  }
}

// ---------------------------------------------------------------------------
loadEnvLocal();
const url = resolveUrl();

console.log(c.bold('\nHackathon Studio — database setup\n'));
info(describe(url));

step(1, 'Connecting');
const client = await connect(url);

const { rows: about } = await client.query(
  'select version() as version, current_database() as db, current_user as who',
);
ok(`connected as ${about[0].who}`);
info(about[0].version.split(' on ')[0]);

if (checkOnly) {
  const { rows: tables } = await client.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  info(`${tables[0].n} table(s) in the public schema`);
  console.log(`\n${c.green('The connection works.')}\n`);
  await client.end();
  process.exit(0);
}

// ---------------------------------------------------------------------------
step(2, 'Creating the roles the policies are written against');

for (const role of ROLES) {
  await client.query(`
    do $$ begin create role ${role} nologin;
    exception when duplicate_object then null; end $$;
  `);
}
ok(`roles present: ${ROLES.join(', ')}`);

// `set role` only works if the connecting user is a member of the target role.
const me = about[0].who;
const quotedUser = `"${me.replace(/"/g, '""')}"`;
for (const role of ROLES) {
  await client.query(`grant ${role} to ${quotedUser}`);
}
ok(`${me} may switch into all three`);

// ---------------------------------------------------------------------------
step(3, 'Applying migrations');

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
    const hint = /permission denied to create extension|must be superuser/i.test(error.message)
      ? 'Only a superuser (or rds_superuser) may create extensions. Run this once as the master user, or ask an admin for: create extension if not exists pgcrypto; create extension if not exists pg_trgm;'
      : 'Nothing after this point ran. Fix the error and run this again — it resumes where it stopped.';
    fail(`${file}: ${error.message}`, hint);
  }
}
ok(ran === 0 ? 'schema already up to date' : `${ran} migration(s) applied`);

// ---------------------------------------------------------------------------
step(4, 'Demo data');

if (!withSeed) {
  info('skipped — pass --seed to load it');
} else if (!existsSync(SEED)) {
  info(`skipped — ${SEED} not found`);
} else {
  const { rows } = await client.query('select count(*)::int as n from public.users');
  if (rows[0].n > 0) {
    info(`skipped — ${rows[0].n} user(s) already exist, refusing to overwrite`);
  } else {
    await client.query(readFileSync(SEED, 'utf8'));
    ok('demo data loaded');
  }
}

await client.end();

const owner = process.env.OWNER_EMAIL;
console.log(`\n${c.green(c.bold('The database is ready.'))}`);
if (owner) {
  console.log(`Sign in as ${c.bold(owner)} — the first sign-in makes it the Owner.`);
} else {
  console.log(`Set ${c.bold('OWNER_EMAIL')} before signing in, or nobody will be the Owner.`);
}
console.log(`Check it from the app with ${c.bold('/api/health/db')}.\n`);
