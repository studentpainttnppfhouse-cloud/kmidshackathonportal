#!/usr/bin/env node
/**
 * `npm run db:aurora`
 *
 * Takes an empty Aurora PostgreSQL cluster to the portal's schema:
 *
 *   1. connects, the same way the app does (IAM token, or a password)
 *   2. creates the three roles Supabase provides and Aurora does not
 *   3. applies every migration, in order, tracking what has already run
 *   4. optionally loads the demo data  (--seed)
 *
 * Flags:
 *   --check   connect and report, change nothing
 *   --seed    load supabase/seed/demo_data.sql into an empty database
 *
 * The alias list below is deliberately a copy of the one in
 * src/lib/aws/config.ts. This script runs outside Next and outside the
 * TypeScript build, so it cannot import it — `scripts/setup.mjs` duplicates
 * the Supabase list for the same reason. Change one, change the other.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS = 'supabase/migrations';
const SEED = 'supabase/seed/demo_data.sql';
const CA_BUNDLE = 'certs/rds-global-bundle.pem';

/** Supabase creates these; a bare Aurora cluster has none of them. */
const ROLES = ['anon', 'authenticated', 'service_role'];

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

const ALIASES = {
  host: ['RDS_HOSTNAME', 'RDS_HOST', 'AURORA_HOST', 'PGHOST', 'POSTGRES_HOST'],
  port: ['RDS_PORT', 'PGPORT', 'POSTGRES_PORT'],
  database: ['RDS_DATABASE', 'RDS_DB_NAME', 'PGDATABASE', 'POSTGRES_DATABASE'],
  user: ['RDS_USERNAME', 'RDS_USER', 'PGUSER', 'POSTGRES_USER'],
  region: ['AWS_REGION', 'AWS_DEFAULT_REGION', 'RDS_REGION'],
  roleArn: ['AWS_ROLE_ARN', 'RDS_ROLE_ARN'],
  password: ['RDS_PASSWORD', 'PGPASSWORD', 'POSTGRES_PASSWORD'],
  url: ['AURORA_DATABASE_URL', 'RDS_DATABASE_URL'],
};

const WHERE = {
  host: 'RDS console > your cluster > Endpoint (the writer endpoint)',
  database: 'RDS console > your cluster > Configuration > DB name',
  user: 'the database user you created and granted rds_iam to',
};

function pick(key) {
  for (const name of ALIASES[key]) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function resolveConfig() {
  let fromUri = {};
  const rawUrl = pick('url');
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      fromUri = {
        host: url.hostname,
        port: url.port ? Number(url.port) : 5432,
        database: url.pathname.replace(/^\//, '') || undefined,
        user: decodeURIComponent(url.username) || undefined,
        password: decodeURIComponent(url.password) || undefined,
      };
    } catch {
      fail('AURORA_DATABASE_URL is not a valid URL.', 'It should look like postgresql://user@host:5432/dbname');
    }
  }

  const config = {
    host: pick('host') ?? fromUri.host,
    port: Number(pick('port') ?? fromUri.port ?? 5432),
    database: pick('database') ?? fromUri.database,
    user: pick('user') ?? fromUri.user,
    region: pick('region'),
    roleArn: pick('roleArn'),
    password: pick('password') ?? fromUri.password,
  };

  const missing = ['host', 'database', 'user'].filter((k) => !config[k]);
  if (missing.length > 0) {
    console.error(`\n${c.red('Missing environment variables:')}\n`);
    for (const key of missing) {
      console.error(`  ${c.bold(ALIASES[key][0])}\n    ${c.dim(WHERE[key])}`);
      console.error(`    ${c.dim(`also accepted as: ${ALIASES[key].slice(1).join(', ')}`)}`);
    }
    console.error(`\nRun ${c.bold('vercel env pull')}, or add them to ${c.bold('.env.local')}.\n`);
    process.exit(1);
  }
  if (!config.roleArn && !config.password) {
    fail(
      'No way to authenticate: neither AWS_ROLE_ARN nor RDS_PASSWORD is set.',
      'AWS_ROLE_ARN comes from the Vercel AWS integration. On a laptop, RDS_PASSWORD is usually simpler.',
    );
  }
  if (config.roleArn && !config.region) {
    fail('AWS_ROLE_ARN is set but AWS_REGION is not.', 'An IAM auth token is signed for one region and cannot fall back to a default.');
  }
  return config;
}

/**
 * The same 15-minute token the app uses.
 *
 * On Vercel the credentials come from the deployment's OIDC token. Here they
 * come from whatever the AWS SDK finds locally — `aws sso login`, a profile in
 * ~/.aws/credentials, or AWS_ACCESS_KEY_ID in the environment.
 */
async function iamAuthToken(config) {
  const { Signer } = await import('@aws-sdk/rds-signer');
  const options = {
    hostname: config.host,
    port: config.port,
    region: config.region,
    username: config.user,
  };

  if (process.env.VERCEL) {
    const { awsCredentialsProvider } = await import('@vercel/functions/oidc');
    options.credentials = awsCredentialsProvider({ roleArn: config.roleArn });
  }

  try {
    return await new Signer(options).getAuthToken();
  } catch (error) {
    fail(
      `Could not sign an IAM auth token: ${error.message}`,
      'Check your local AWS credentials (`aws sts get-caller-identity`), or set RDS_PASSWORD to connect with a password instead.',
    );
  }
}

/**
 * Aurora requires TLS; a Postgres on your own machine almost never offers it.
 * Decide from the host rather than assuming, so this script also works against
 * a local database — `scripts/setup.mjs` makes the same call for Supabase.
 */
function isLocal(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(host) || host.startsWith('/');
}

function sslOptions(config) {
  if (isLocal(config.host)) return false;
  if (!existsSync(CA_BUNDLE)) {
    fail(
      `${CA_BUNDLE} is missing.`,
      'Download it: curl -o certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem',
    );
  }
  return { ca: readFileSync(CA_BUNDLE, 'utf8'), rejectUnauthorized: true };
}

async function connect(config) {
  const password = config.roleArn ? await iamAuthToken(config) : config.password;
  const client = new pg.Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    ssl: sslOptions(config),
    connectionTimeoutMillis: 15_000,
  });

  try {
    await client.connect();
  } catch (error) {
    const m = error.message.toLowerCase();
    let hint = 'Check the endpoint, the database name and the user.';
    if (m.includes('timeout') || m.includes('etimedout')) {
      hint = 'The cluster did not answer. Check it is publicly accessible and that its security group allows inbound TCP 5432 from your IP.';
    } else if (m.includes('pg_hba') || m.includes('password authentication failed')) {
      hint = config.roleArn
        ? 'The IAM token was rejected. Check IAM database authentication is on for the cluster, and that the user was granted rds_iam.'
        : 'The password was rejected. Check RDS_USERNAME and RDS_PASSWORD.';
    } else if (m.includes('certificate')) {
      hint = 'TLS verification failed — certs/rds-global-bundle.pem may be out of date.';
    }
    fail(`Could not connect: ${error.message}`, hint);
  }
  return client;
}

// ---------------------------------------------------------------------------
loadEnvLocal();
const config = resolveConfig();

console.log(c.bold('\nHackathon Studio — Aurora setup\n'));
info(`${config.user}@${config.host}:${config.port}/${config.database}`);
info(config.roleArn ? `authenticating with an IAM token (${config.region})` : 'authenticating with a password');

step(1, 'Connecting');
const client = await connect(config);

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
step(2, 'Creating the Supabase-compatible roles');

/**
 * Every RLS policy in supabase/migrations is written `to authenticated`, and
 * 0090_grants.sql grants privileges to all three. They exist on Supabase by
 * default; on Aurora they have to be made, or the migrations fail on the first
 * policy.
 */
for (const role of ROLES) {
  await client.query(`
    do $$ begin create role ${role} nologin;
    exception when duplicate_object then null; end $$;
  `);
}
ok(`roles present: ${ROLES.join(', ')}`);

/**
 * The application connects as one user and switches role per request, exactly
 * as PostgREST does. `set role` only works if the connecting user is a member
 * of the target role.
 */
const quotedUser = `"${config.user.replace(/"/g, '""')}"`;
for (const role of ROLES) {
  await client.query(`grant ${role} to ${quotedUser}`);
}
ok(`${config.user} may switch into all three`);

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
      ? 'Aurora only lets rds_superuser create extensions. Connect as your cluster’s master user for this step, or ask an admin to run: create extension if not exists pgcrypto; create extension if not exists pg_trgm;'
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

console.log(`\n${c.green(c.bold('Aurora is ready.'))}`);
console.log(`Check it from the app with ${c.bold('/api/health/db')}.\n`);
