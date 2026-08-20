import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Service-role client. Bypasses every RLS policy, so it is used for exactly
 * three things and nothing else:
 *
 *   1. resolving a device session cookie back to a user (which has to happen
 *      before we have a token to authenticate with),
 *   2. provisioning an account on first sign-in,
 *   3. applying Owner Console decisions that the privilege guard trigger
 *      deliberately refuses from a normal token.
 *
 * Every other read and write in the app goes through `userClient()` so the
 * database — not this process — decides what is allowed.
 */
let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const e = env();
  cached = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
