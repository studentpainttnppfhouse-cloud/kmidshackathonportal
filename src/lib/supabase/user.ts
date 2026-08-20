import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import { env } from '@/lib/env';

/**
 * A Supabase client that talks to PostgREST as a specific user.
 *
 * Sign-in is email-only with no password and no OAuth, so there is no Supabase
 * Auth session to borrow a token from. Instead we mint a short-lived HS256 JWT
 * with the project's own JWT secret. PostgREST validates it exactly as it would
 * a Supabase Auth token and populates `request.jwt.claims`, which is what every
 * RLS policy in supabase/migrations reads.
 *
 * The token carries an id and nothing else that matters. Tier, status and
 * department are read from the `users` table by the policy helpers on every
 * single call, so a stale or tampered token cannot widen anyone's access.
 */
const TOKEN_TTL_SECONDS = 60 * 10;

export async function signUserToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(env().SUPABASE_JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({ sub: userId, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(secret);
}

export async function userClient(userId: string): Promise<SupabaseClient> {
  const e = env();
  const token = await signUserToken(userId);

  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Anonymous client, for the public form submission pages only. */
export function anonClient(): SupabaseClient {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
