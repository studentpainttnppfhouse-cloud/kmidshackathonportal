import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { databaseUrl } from '@/lib/env';

/**
 * The one connection pool.
 *
 * The portal talks to PostgreSQL directly — one `DATABASE_URL`, one pool, no
 * vendor SDK in between. On Render that variable is set in the dashboard and
 * points at the RDS cluster; on a laptop it points at a local Postgres.
 *
 * Node runtime only: `pg` needs Node APIs, so any route handler that reaches
 * the database must export `runtime = 'nodejs'`.
 */

// Postgres `date`, `time` and `timestamp without time zone` come back as bare
// strings ("2027-03-20", "07:00:00") rather than as Date objects. The whole UI
// treats these as plain strings — event day is a wall-clock date in Bangkok,
// not an instant — and parsing them into Dates would shift them by the
// server's offset the moment they were serialised back out.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1083, (v) => v);
pg.types.setTypeParser(1114, (v) => v);

// int8: `count(*)` returns bigint, which node-pg hands back as a string so no
// precision is lost. Nothing here ever counts past 2^53, and a string count
// would break every `count > 0` comparison in the app.
pg.types.setTypeParser(20, (v) => Number(v));

/**
 * AWS publishes one CA bundle covering every RDS region, and it is committed
 * to the repo so TLS is genuinely verified. The alternative everyone reaches
 * for — `rejectUnauthorized: false` — encrypts the connection but accepts any
 * certificate at all, and so defends against nothing.
 */
let caCache: string | null = null;

function rdsCertificateAuthority(): string {
  if (caCache) return caCache;
  const inline = process.env.RDS_CA_CERT;
  caCache =
    inline && inline.trim() !== ''
      ? inline
      : readFileSync(join(process.cwd(), 'certs', 'rds-global-bundle.pem'), 'utf8');
  return caCache;
}

/**
 * A database on your own machine almost never offers TLS, and RDS always
 * requires it, so decide from the host rather than from a flag someone has to
 * remember to set.
 */
export function sslFor(url: string): pg.PoolConfig['ssl'] {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }

  const local =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (local) return false;

  // `?sslmode=disable` in the URL wins, for a host that proxies TLS itself.
  if (/[?&]sslmode=disable\b/.test(url)) return false;

  return { ca: rdsCertificateAuthority(), rejectUnauthorized: true };
}

function buildPool(): pg.Pool {
  const url = databaseUrl();
  return new pg.Pool({
    connectionString: url,
    ssl: sslFor(url),
    // Render runs a small number of long-lived instances rather than a
    // function per request, so a modest pool per instance is right. RDS shares
    // its connection limit across every instance at once.
    max: Number(process.env.DATABASE_POOL_MAX ?? 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Cached on globalThis rather than in a module variable: Next reloads modules
 * on every edit in development, and a fresh pool per reload exhausts the
 * database's connection limit within a few saves.
 */
const globalForPool = globalThis as unknown as { portalPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForPool.portalPool) {
    const created = buildPool();
    // Without a listener, a dropped idle connection takes the process down.
    created.on('error', (error) => {
      console.error('[db] idle client error:', error.message);
    });
    globalForPool.portalPool = created;
  }
  return globalForPool.portalPool;
}

export type { PoolClient, QueryResultRow } from 'pg';
