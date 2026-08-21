import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { isLocalHost, resolveAurora, type AuroraConfig } from '@/lib/aws/config';
import { registerTypeParsers } from '@/lib/pg/types';

/**
 * The Aurora PostgreSQL connection.
 *
 * On Vercel there is no database password. The deployment holds a short-lived
 * OIDC token, `@vercel/functions` exchanges it for credentials on an AWS IAM
 * role, and `@aws-sdk/rds-signer` signs those into a 15-minute RDS auth token
 * that is handed to Postgres in the password field. Nothing long-lived is ever
 * stored, so there is no database secret in the Vercel dashboard to leak.
 *
 * A plain `RDS_PASSWORD` is accepted as well, because a laptop has no OIDC
 * token to exchange.
 *
 * Node runtime only — the AWS SDK and `pg` both need Node APIs. Any route that
 * imports this must export `runtime = 'nodejs'`.
 */

// Row values must decode the way PostgREST decoded them, or every date in the
// UI shifts and `files.size` stops being a number. See lib/pg/types.
registerTypeParsers();

/**
 * AWS publishes one CA bundle covering every RDS region. It is committed so
 * that TLS is actually verified: the alternative everyone reaches for is
 * `rejectUnauthorized: false`, which encrypts the connection but accepts any
 * certificate at all, and so defends against nothing.
 */
let caCache: string | null = null;

function rdsCertificateAuthority(): string {
  if (caCache) return caCache;
  const inline = process.env.RDS_CA_CERT;
  caCache = inline && inline.trim() !== ''
    ? inline
    : readFileSync(join(process.cwd(), 'certs', 'rds-global-bundle.pem'), 'utf8');
  return caCache;
}

/**
 * IAM auth tokens are valid for 15 minutes. Signing is a local operation, but
 * fetching the credentials behind it is a network call, so cache the token and
 * re-sign a little early rather than on every new connection.
 */
const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_REFRESH_MS = 13 * 60 * 1000;

let tokenCache: { value: string; expiresAt: number } | null = null;

async function iamAuthToken(config: AuroraConfig, roleArn: string): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  // Imported here rather than at the top of the file: IAM authentication is
  // one of three ways to connect, and a deployment that hands over a
  // connection URI — which is most of them — should not have to load the AWS
  // SDK, or have it installed at all, to open a connection.
  const [{ Signer }, { awsCredentialsProvider }] = await Promise.all([
    import('@aws-sdk/rds-signer'),
    import('@vercel/functions/oidc'),
  ]);

  const signer = new Signer({
    hostname: config.host,
    port: config.port,
    region: config.region,
    username: config.user,
    credentials: awsCredentialsProvider({ roleArn }),
  });

  const value = await signer.getAuthToken();
  tokenCache = { value, expiresAt: Date.now() + TOKEN_REFRESH_MS };
  return value;
}

/** Thrown when Aurora is reached before it has been configured. */
export class AuroraNotConfiguredError extends Error {
  constructor(readonly problems: { key: string; reason: string }[]) {
    super(
      `Aurora is not configured: ${problems.map((p) => `${p.key} ${p.reason}`).join(', ')}. ` +
        'Run `vercel env pull` after linking the project, or see README.md.',
    );
    this.name = 'AuroraNotConfiguredError';
  }
}

function buildPool(): pg.Pool {
  const resolved = resolveAurora();
  if (!resolved.config) throw new AuroraNotConfiguredError(resolved.problems);
  const config = resolved.config;

  return new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    // A function, for IAM: `pg` calls it on every new connection, so an expired
    // token is replaced without recycling the pool. Undefined for a local
    // database that authenticates by trust.
    password:
      config.auth.kind === 'iam'
        ? () => iamAuthToken(config, (config.auth as { roleArn: string }).roleArn)
        : config.auth.kind === 'password'
          ? config.auth.password
          : undefined,
    ssl: isLocalHost(config.host)
      ? false
      : { ca: rdsCertificateAuthority(), rejectUnauthorized: true },

    // Serverless sizing. Each Vercel instance handles one request at a time, so
    // a large pool per instance buys nothing and Aurora's connection limit is
    // shared across every warm instance at once.
    max: Number(process.env.RDS_POOL_MAX ?? 4),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Never outlive the IAM token that opened the connection.
    maxLifetimeSeconds: Math.floor(TOKEN_TTL_MS / 1000),
  });
}

/**
 * Cached on globalThis rather than in a module variable: Next reloads modules
 * on every edit in development, and a fresh pool per reload exhausts Aurora's
 * connection limit within a few saves.
 */
const globalForPool = globalThis as unknown as { auroraPool?: pg.Pool };

export function auroraPool(): pg.Pool {
  if (!globalForPool.auroraPool) {
    const pool = buildPool();
    // Without a listener, a dropped idle connection crashes the process.
    pool.on('error', (error) => {
      console.error('[aurora] idle client error:', error.message);
    });
    globalForPool.auroraPool = pool;
  }
  return globalForPool.auroraPool;
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** One statement, on a pooled connection, with no RLS session set. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  const result = await auroraPool().query<T>(text, values);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

/**
 * Run statements as a specific user, with RLS applied.
 *
 * This is the whole reason the permission model survives the move off
 * Supabase. PostgREST authorises a request by switching to the `authenticated`
 * role and putting the JWT claims in `request.jwt.claims`; every policy in
 * `db/migrations` reads them through `app.uid()`. Doing the same two
 * statements here means those policies — not this process — keep deciding what
 * each user can see.
 *
 * Both settings are transaction-local (`set local`, and `true` as the third
 * argument to `set_config`), so a connection returned to the pool carries no
 * trace of the user it just served.
 */
export async function withRls<T>(
  userId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await auroraPool().connect();
  const claims = userId
    ? JSON.stringify({ sub: userId, role: 'authenticated' })
    : JSON.stringify({ role: 'anon' });

  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
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

/** A transaction with no role switch — for migrations and Owner-level writes. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await auroraPool().connect();
  try {
    await client.query('begin');
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
