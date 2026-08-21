#!/usr/bin/env node
/**
 * `npm run db:relations`
 *
 * Regenerates the foreign-key table in src/lib/pg/relationships.ts from the
 * migrations.
 *
 * The query builder needs the FK graph to resolve an embed like
 * `owner:owner_id ( name )`. PostgREST read that from the live database; doing
 * the same at runtime would mean a query could silently start resolving
 * differently after a migration, so the graph is generated, committed, and
 * reviewed like any other code. Run this whenever a foreign key changes —
 * `--check` fails if the file is stale, which is what CI should call.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';
const TARGET = 'src/lib/pg/relationships.ts';
const START = 'export const FOREIGN_KEYS: ForeignKeys = {';
const END = '};';

const checkOnly = process.argv.includes('--check');

function readMigrations() {
  let sql = '';
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    sql += readFileSync(join(MIGRATIONS, file), 'utf8') + '\n';
  }
  // Strip line comments so a commented-out `references` is not picked up.
  return sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
}

function extract(sql) {
  const tables = {};
  const tableRe = /create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\);/g;
  let table;
  while ((table = tableRe.exec(sql))) {
    const [, name, body] = table;
    tables[name] ??= {};
    const columnRe =
      /^\s*([a-z_]+)\s+[^,\n]*?references\s+(?:public\.)?([a-z_]+)\s*\(\s*([a-z_]+)\s*\)/gm;
    let column;
    while ((column = columnRe.exec(body))) {
      tables[name][column[1]] = [column[2], column[3]];
    }
  }
  return tables;
}

function render(tables) {
  return Object.keys(tables)
    .sort()
    .map((name) => {
      const columns = Object.entries(tables[name]);
      if (columns.length === 0) return `  ${name}: {},`;
      const body = columns
        .map(([column, [refTable, refColumn]]) => `    ${column}: ['${refTable}', '${refColumn}'],`)
        .join('\n');
      return `  ${name}: {\n${body}\n  },`;
    })
    .join('\n');
}

const current = readFileSync(TARGET, 'utf8');
const start = current.indexOf(START);
const end = current.indexOf(`\n${END}`, start);
if (start === -1 || end === -1) {
  console.error(`Could not find the FOREIGN_KEYS block in ${TARGET}.`);
  process.exit(1);
}

const generated = render(extract(readMigrations()));
const next = `${current.slice(0, start + START.length)}\n${generated}${current.slice(end)}`;

if (next === current) {
  console.log(`${TARGET} is up to date.`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `${TARGET} is out of date with ${MIGRATIONS}. Run \`npm run db:relations\` and commit.`,
  );
  process.exit(1);
}

writeFileSync(TARGET, next);
console.log(`Updated ${TARGET}.`);
