import { QueryBuilder, type Executor, type PgError, type Result } from './builder';

export type { Executor, PgError, Result } from './builder';

/**
 * The `db.from('table')...` entry point the whole app is written against.
 *
 * A client is nothing but a bound executor: what decides whether RLS applies
 * is which executor it was built with, not anything the caller does.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PgClient {
  from<T = any>(table: string): QueryBuilder<T, T[]>;
  /**
   * Call a database function, as PostgREST's `.rpc()` did. Arguments are
   * passed positionally and always as parameters, never interpolated.
   */
  rpc(name: string, args?: unknown[]): Promise<{ error: PgError | null }>;
}

export function createClient(exec: Executor): PgClient {
  return {
    from<T = any>(table: string) {
      return new QueryBuilder<T, T[]>(table, exec);
    },

    async rpc(name: string, args: unknown[] = []) {
      if (!/^[a-z_][a-z0-9_.]*$/i.test(name)) {
        return { error: { message: `Unsafe function name: "${name}"` } };
      }
      const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
      try {
        await exec(`select ${name}(${placeholders})`, args);
        return { error: null };
      } catch (error) {
        const e = error as { message?: string; code?: string };
        return { error: { message: e?.message ?? String(error), code: e?.code } };
      }
    },
  };
}

export type { Result as PgResult };
