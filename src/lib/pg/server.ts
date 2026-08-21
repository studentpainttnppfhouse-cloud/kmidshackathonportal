import 'server-only';
import { auroraPool, transaction, withRls } from '@/lib/aws/pool';
import { createClient, type Executor, type PgClient } from './client';

/**
 * The three ways this app talks to the database, in place of the three
 * Supabase clients it used to build.
 *
 * The difference between them is only ever which connection context the
 * statement runs in — never a check written in TypeScript. `userClient` and
 * `anonClient` run inside a transaction that switches role and publishes the
 * request's claims, so the policies in supabase/migrations do the deciding;
 * `adminClient` runs as the connection's own role, which owns the tables and
 * therefore bypasses RLS the way `service_role` used to.
 */

/** One statement per transaction, in a user's shoes. Mirrors a PostgREST request. */
function rlsExecutor(userId: string | null): Executor {
  return async (text, values) =>
    withRls(userId, async (client) => (await client.query(text, values)).rows);
}

/**
 * A client scoped to one signed-in user.
 *
 * Async only because the Supabase version had to mint a JWT first; keeping the
 * signature means every `await userClient(user.id)` call site is unchanged.
 */
export async function userClient(userId: string): Promise<PgClient> {
  return createClient(rlsExecutor(userId));
}

/** Logged-out visitors — the public form pages and nothing else. */
export function anonClient(): PgClient {
  return createClient(rlsExecutor(null));
}

/**
 * Bypasses every policy, so it is used for exactly three things and nothing
 * else:
 *
 *   1. resolving a device session cookie back to a user (which has to happen
 *      before there is a user to run as),
 *   2. provisioning an account on first sign-in,
 *   3. applying Owner Console decisions that the privilege guard trigger
 *      deliberately refuses from a normal session.
 *
 * Every other read and write goes through `userClient()`.
 */
export function adminClient(): PgClient {
  return createClient(async (text, values) => {
    const result = await auroraPool().query(text, values);
    return result.rows;
  });
}

/** Several statements as one unit, bypassing RLS. For Owner-level writes. */
export { transaction };
