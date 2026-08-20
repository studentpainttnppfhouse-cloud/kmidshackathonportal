import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { envProblems } from '@/lib/env';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * `GET /api/health/db` — does the database connection actually work?
 *
 * Written as something worth keeping rather than a one-off: it names the
 * variable that is missing rather than returning a stack trace, so a
 * first-time deploy tells you what to fix.
 *
 * It sits under the `/api/health` prefix that middleware already lets through
 * without a session, because the deploy you most need to diagnose is the one
 * where nobody can sign in yet. Being reachable anonymously, it says whether
 * the connection works but not what it connects to: the host, database and
 * user are filled in only for a request carrying a session cookie. That is the
 * same cheap signal middleware uses — deliberately not `getSessionUser()`,
 * which would route this check through the database and make it useless
 * exactly when the database is what is broken.
 */

// `pg` needs Node APIs, and a pool is pointless on a runtime that cannot hold
// one open between requests.
export const runtime = 'nodejs';
// A cached health check is a health check of the cache.
export const dynamic = 'force-dynamic';

interface ServerRow {
  version: string;
  database: string;
  user: string;
  now: string;
}

export async function GET() {
  const problems = envProblems().filter((p) => p.key === 'DATABASE_URL');
  const signedIn = (await cookies()).has(SESSION_COOKIE);

  if (problems.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'configuration',
        message: 'The database connection is not configured yet.',
        missing: problems.map((p) => ({
          variable: p.key,
          reason: p.reason,
          where: p.source,
          alsoAcceptedAs: p.alsoAccepts,
        })),
        hint: 'Set DATABASE_URL in the Render dashboard, then redeploy. See README.md.',
      },
      { status: 503 },
    );
  }

  const startedAt = Date.now();

  try {
    // Imported here, not at the top: a misconfigured deploy should reach the
    // report above rather than fail while opening a pool.
    const { sql } = await import('@/lib/db/client');
    const rows = await sql<ServerRow>(
      'select version() as version, current_database() as database, ' +
        'current_user as "user", now()::text as now',
    );
    const row = rows[0];

    // Whether the schema is actually there. A connection that works against an
    // empty database is the other half of "why is nothing loading".
    const [applied] = await sql<{ tables: number }>(
      "select count(*)::int as tables from information_schema.tables " +
        "where table_schema = 'public'",
    );

    return NextResponse.json({
      ok: true,
      serverVersion: row?.version.split(' ').slice(0, 2).join(' ') ?? null,
      serverTime: row?.now ?? null,
      roundTripMs: Date.now() - startedAt,
      publicTables: applied?.tables ?? 0,
      schema:
        (applied?.tables ?? 0) > 0
          ? 'applied'
          : 'empty — run `npm run db:setup` against this database',
      // Which database, for someone entitled to know. Enough to tell a staging
      // copy from the real one when both answer.
      ...(signedIn
        ? { database: row?.database ?? null, connectedAs: row?.user ?? null }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      { ok: false, stage: 'connection', message, hint: diagnose(message) },
      { status: 503 },
    );
  }
}

/**
 * The ways this fails in practice, each with the thing to go and change.
 * Postgres's own errors are accurate but say nothing about which dashboard
 * page fixes them.
 */
function diagnose(message: string): string {
  const m = message.toLowerCase();

  if (m.includes('timeout') || m.includes('etimedout') || m.includes('econnrefused')) {
    return 'The database did not answer. If it is on RDS, check that the instance is publicly accessible and that its security group allows inbound TCP 5432 from your Render service’s outbound IPs.';
  }
  if (m.includes('pg_hba') || m.includes('password authentication failed')) {
    return 'The credentials in DATABASE_URL were rejected. Check the user and password, and that the password is URL-encoded if it contains punctuation.';
  }
  if (m.includes('certificate') || m.includes('self-signed') || m.includes('unable to verify')) {
    return 'TLS verification failed. certs/rds-global-bundle.pem may be out of date — re-download it from https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem, or set RDS_CA_CERT to your provider’s certificate.';
  }
  if (m.includes('does not exist')) {
    return 'The database or role named in DATABASE_URL does not exist on that server.';
  }
  if (m.includes('too many clients')) {
    return 'The server is out of connection slots. Lower DATABASE_POOL_MAX, or raise max_connections.';
  }
  return 'Run `npm run db:setup -- --check` locally against the same DATABASE_URL for fuller output.';
}
