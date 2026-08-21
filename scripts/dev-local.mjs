#!/usr/bin/env node
/**
 * `npm run dev:local`
 *
 * Brings up the whole portal against a local Postgres, with no AWS account and
 * no cloud anything:
 *
 *   1. checks the database is reachable and creates it if it is missing
 *   2. applies any migrations that have not run yet
 *   3. seeds the demo data the first time
 *   4. starts Next, pointed at that database and at a directory for uploads
 *
 * There is no API shim any more: the app talks to Postgres directly, so what
 * runs here is the same data layer that runs in production, against the same
 * migrations and the same RLS policies.
 *
 * Point DEV_DATABASE_URL at your Postgres if it is not on the default socket.
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const DATABASE_URL =
  process.env.DEV_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/hackathon_studio';
const MIGRATIONS = 'supabase/migrations';
const SEED = 'supabase/seed/demo_data.sql';
const FILES_DIR = process.env.FILES_DIR ?? '.storage';

function log(msg) { console.log(`\x1b[35m[dev-local]\x1b[0m ${msg}`); }

async function ensureDatabase() {
  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const admin = new pg.Client({ connectionString: DATABASE_URL.replace(`/${dbName}`, '/postgres') });
  try {
    await admin.connect();
  } catch (error) {
    console.error(`\nCould not reach Postgres at ${url.host || 'the default socket'}.`);
    console.error('Start Postgres, or set DEV_DATABASE_URL to point at it.\n');
    console.error(error.message);
    process.exit(1);
  }

  const { rows } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (rows.length === 0) {
    log(`creating database ${dbName}`);
    await admin.query(`create database "${dbName}"`);
  }

  // The policies grant to these three roles; a fresh Postgres has none of them.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await admin.query(`
      do $$ begin create role ${role} nologin;
      exception when duplicate_object then null; end $$;
    `);
  }
  await admin.end();
}

async function applyMigrations() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  await client.query(`
    create table if not exists public._migrations (
      name text primary key, applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query('select name from public._migrations')).rows.map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    log(`applying ${file}`);
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    try {
      await client.query(sql);
      await client.query('insert into public._migrations (name) values ($1)', [file]);
      count += 1;
    } catch (error) {
      console.error(`\nMigration ${file} failed:\n  ${error.message}\n`);
      process.exit(1);
    }
  }

  if (count === 0) log('migrations already up to date');

  // Seed once, only into an empty database.
  const { rows } = await client.query('select count(*)::int as n from public.users');
  if (rows[0].n === 0 && existsSync(SEED)) {
    log('seeding demo data');
    await client.query(readFileSync(SEED, 'utf8'));
  }

  await client.end();
}

function run(name, command, args, env) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev-local] ${name} exited with ${code}`);
      process.exit(code);
    }
  });
  return child;
}

await ensureDatabase();
await applyMigrations();

log('starting Next on :3000');
log(`uploads go to ${FILES_DIR}`);
log('sign in as june@kmids.ac.th (Owner) — no password');

const next = run('next', 'npx', ['next', 'dev', '-p', '3000'], {
  // The app reads the same names in development as in production; a whole URI
  // is one of the shapes src/lib/aws/config.ts already accepts.
  AURORA_DATABASE_URL: DATABASE_URL,
  // FILES_DIR selects the on-disk storage driver, so uploads work without S3.
  FILES_DIR: FILES_DIR,
  OWNER_EMAIL: process.env.OWNER_EMAIL ?? 'june@kmids.ac.th',
  SCHOOL_EMAIL_DOMAIN: process.env.SCHOOL_EMAIL_DOMAIN ?? 'kmids.ac.th',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    next.kill();
    process.exit(0);
  });
}
