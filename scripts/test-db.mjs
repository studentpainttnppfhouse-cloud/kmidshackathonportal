#!/usr/bin/env node
/**
 * `npm run db:testdb`
 *
 * Creates a throwaway database, applies every migration and loads the demo
 * data, then prints the URL to export as TEST_DATABASE_URL.
 *
 * tests/pg-integration.test.ts skips itself unless that variable is set. Those
 * are the tests worth having: they run the app's real queries against the real
 * migrations and check that RLS still filters what comes back. Unit tests can
 * only prove the generated SQL looks right.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const URL_ = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/hackathon_test';
const MIGRATIONS = 'db/migrations';
const SEED = 'db/seed/demo_data.sql';

const url = new URL(URL_);
const name = url.pathname.slice(1);

const admin = new pg.Client({ connectionString: URL_.replace(`/${name}`, '/postgres') });
try {
  await admin.connect();
} catch (error) {
  console.error(`\nCould not reach Postgres at ${url.host}.`);
  console.error('Start Postgres, or set TEST_DATABASE_URL to point at it.\n');
  console.error(error.message);
  process.exit(1);
}

// Always start clean: a half-migrated database makes for confusing failures.
await admin.query(`drop database if exists "${name}" with (force)`);
await admin.query(`create database "${name}"`);
for (const role of ['anon', 'authenticated', 'service_role']) {
  await admin.query(`
    do $$ begin create role ${role} nologin;
    exception when duplicate_object then null; end $$;
  `);
}
await admin.end();

const db = new pg.Client({ connectionString: URL_ });
await db.connect();

for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
  } catch (error) {
    console.error(`\nMigration ${file} failed:\n  ${error.message}\n`);
    process.exit(1);
  }
}

if (existsSync(SEED)) await db.query(readFileSync(SEED, 'utf8'));
await db.end();

console.log(`\nReady. Run the integration tests with:\n\n  TEST_DATABASE_URL="${URL_}" npm test\n`);
