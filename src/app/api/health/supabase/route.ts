import { NextResponse } from 'next/server';
import { envProblems } from '@/lib/env';

/**
 * `GET /api/health/supabase` — is this deployment wired to a Supabase project?
 *
 * The Supabase counterpart to `/api/health/db`. Every app route resolves a
 * session before it renders anything, and that needs the service-role key, so
 * a deploy with no credentials fails on all of them at once with nothing to
 * go on. This answers the question directly instead.
 *
 * It sits under the `/api/health` prefix middleware already lets through
 * without a session, because the deploy you most need to diagnose is the one
 * where nobody can sign in yet. It names the variables that are missing —
 * names, never values — and never echoes a key back.
 */
export const runtime = 'nodejs';
// A cached health check is a health check of the cache.
export const dynamic = 'force-dynamic';

export async function GET() {
  const problems = envProblems();

  if (problems.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        stage: 'configuration',
        message: 'Supabase is not configured on this deployment.',
        missing: problems.map((p) => ({
          variable: p.key,
          reason: p.reason,
          where: p.source,
          alsoAcceptedAs: p.alsoAccepts,
        })),
        hint:
          'Set these in Vercel > Settings > Environment Variables for the environment you are hitting — Preview and Production are separate — then redeploy. NEXT_PUBLIC_ values are baked into the build, so saving them alone does not fix an existing deployment.',
      },
      { status: 503 },
    );
  }

  const startedAt = Date.now();

  try {
    // Imported here, not at the top: a misconfigured deploy should reach the
    // report above rather than fail while constructing a client.
    const { adminClient } = await import('@/lib/supabase/admin');
    const { error } = await adminClient()
      .from('users')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          stage: 'query',
          message: error.message,
          hint: diagnose(error.message),
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ ok: true, roundTripMs: Date.now() - startedAt });
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
 * Supabase's own errors are accurate but say nothing about which page fixes
 * them.
 */
function diagnose(message: string): string {
  const m = message.toLowerCase();

  if (m.includes('does not exist') || m.includes('schema cache')) {
    return 'The project answered but has no schema yet. Run `npm run db:setup` against it.';
  }
  if (m.includes('invalid api key') || m.includes('jwt') || m.includes('unauthorized')) {
    return 'The key was rejected. Check SUPABASE_SERVICE_ROLE_KEY belongs to the same project as NEXT_PUBLIC_SUPABASE_URL.';
  }
  if (m.includes('fetch failed') || m.includes('enotfound') || m.includes('timeout')) {
    return 'The project URL did not answer. Check NEXT_PUBLIC_SUPABASE_URL, and that the project is not paused.';
  }
  return 'Check the four Supabase variables against Supabase > Settings > API, then redeploy.';
}
