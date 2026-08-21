/**
 * The two statements that put a connection into a user's shoes.
 *
 * PostgREST authorised a request by switching to the `authenticated` role and
 * publishing the JWT claims as `request.jwt.claims`; every policy in
 * db/migrations reads them back through `app.uid()`. Reproducing exactly
 * that here is what lets the whole permission model survive the move off
 * Supabase untouched — the policies, not this process, still decide what each
 * user can see.
 *
 * Kept free of `server-only` and of any driver import so the integration tests
 * can establish an identical context against a throwaway database.
 */

/** The claims blob a policy will read. Anonymous requests get the `anon` role. */
export function jwtClaims(userId: string | null): string {
  return userId
    ? JSON.stringify({ sub: userId, role: 'authenticated' })
    : JSON.stringify({ role: 'anon' });
}

export function roleFor(userId: string | null): 'authenticated' | 'anon' {
  return userId ? 'authenticated' : 'anon';
}

/**
 * `true` as the third argument makes the setting transaction-local, so a
 * connection handed back to the pool carries no trace of the user it served.
 */
export const SET_CLAIMS_SQL = "select set_config('request.jwt.claims', $1, true)";
