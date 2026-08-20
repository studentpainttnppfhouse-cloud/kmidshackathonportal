import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { resolveAurora } from '@/lib/aws/config';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * `GET /api/health/db` — does the Aurora connection actually work?
 *
 * This is the "Hello World" step of the Vercel guide, written as something you
 * can keep: it names the variable that is missing rather than returning a
 * stack trace, so a first-time deploy tells you what to fix. It reports on the
 * Aurora cluster only — the portal itself still reads and writes through
 * Supabase.
 *
 * It sits under the `/api/health` prefix that middleware already lets through
 * without a session, because the deploy you most need to diagnose is the one
 * where nobody can sign in yet. Being reachable anonymously, it says whether
 * the connection works but not what it connects to: the endpoint, database and
 * user are filled in only for a request that carries a session cookie. That is
 * the same cheap signal middleware uses — deliberately not `getSessionUser()`,
 * which would route this check through Supabase and make it useless exactly
 * when Supabase is what is broken.
 */

// The AWS SDK and `pg` both need Node APIs, and a pool is pointless on an edge
// runtime that cannot hold one open between requests.
export const runtime = 'nodejs';
// A cached health check is a health check of the cache.
export const dynamic = 'force-dynamic';

export async function GET() {
  const resolved = resolveAurora();
  const signedIn = (await cookies()).has(SESSION_COOKIE);

  if (!resolved.config) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'configuration',
        message: 'Aurora is not configured yet.',
        missing: resolved.problems.map((p) => ({
          variable: p.key,
          reason: p.reason,
          where: p.source,
          alsoAcceptedAs: p.alsoAccepts,
        })),
        hint: 'Link the project and run `vercel env pull`, then restart. See README.md > Aurora.',
      },
      { status: 503 },
    );
  }

  const { config } = resolved;
  const startedAt = Date.now();

  try {
    // Imported here, not at the top: a misconfigured deploy should reach the
    // report above rather than fail while loading the AWS SDK.
    const { query } = await import('@/lib/aws/pool');
    const { rows } = await query<{
      version: string;
      database: string;
      user: string;
      now: string;
    }>('select version() as version, current_database() as database, current_user as "user", now()::text as now');

    const row = rows[0];

    return NextResponse.json({
      ok: true,
      authentication: config.auth.kind === 'iam' ? 'IAM (Vercel OIDC, no password)' : 'password',
      serverVersion: row?.version.split(' ').slice(0, 2).join(' ') ?? null,
      serverTime: row?.now ?? null,
      roundTripMs: Date.now() - startedAt,
      // Which cluster, for someone entitled to know. Enough to tell a staging
      // database from the real one when both answer.
      ...(signedIn
        ? {
            region: config.region || null,
            host: config.host,
            database: row?.database ?? config.database,
            connectedAs: row?.user ?? config.user,
          }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return NextResponse.json(
      {
        ok: false,
        stage: 'connection',
        message,
        hint: diagnose(message, config.auth.kind),
        ...(signedIn ? { host: config.host } : {}),
      },
      { status: 503 },
    );
  }
}

/**
 * The four ways this fails in practice, each with the thing to go and change.
 * Aurora's own errors are accurate but say nothing about which console page
 * fixes them.
 */
function diagnose(message: string, authKind: 'iam' | 'password'): string {
  const m = message.toLowerCase();

  if (m.includes('timeout') || m.includes('etimedout') || m.includes('econnrefused')) {
    return 'The cluster did not answer. Check that it is publicly accessible, and that its security group allows inbound TCP 5432 from Vercel.';
  }
  if (m.includes('pg_hba') || m.includes('password authentication failed')) {
    return authKind === 'iam'
      ? 'The IAM token was rejected. Check IAM database authentication is enabled on the cluster, and that the database user was granted `rds_iam`.'
      : 'The password was rejected. Check RDS_USERNAME and RDS_PASSWORD.';
  }
  if (m.includes('certificate') || m.includes('self-signed') || m.includes('unable to verify')) {
    return 'TLS verification failed. certs/rds-global-bundle.pem may be out of date — re-download it from https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem.';
  }
  if (m.includes('does not exist')) {
    return 'The database or user named does not exist on this cluster. Check RDS_DATABASE and RDS_USERNAME.';
  }
  if (m.includes('credential') || m.includes('assume') || m.includes('oidc') || m.includes('token')) {
    return 'AWS would not issue credentials. Check AWS_ROLE_ARN, and that the role trusts Vercel’s OIDC issuer for this project.';
  }
  return 'Run `npm run db:aurora -- --check` locally for the same connection with fuller output.';
}
