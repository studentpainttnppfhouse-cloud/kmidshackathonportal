import pg from 'pg';

/**
 * Make `pg` hand back the same JavaScript values PostgREST did.
 *
 * This is not cosmetic. `pg` decodes `timestamptz` into a `Date` and `bigint`
 * into a string, where PostgREST produced an ISO string and a number. Left
 * alone, every `created_at` in the app would arrive as a Date — which a Server
 * Component cannot serialise across to the client — and `files.size` would
 * become a string that fails the arithmetic on the upload screen. Registering
 * these parsers keeps the row shapes the screens already destructure.
 *
 * Global to the `pg` module, so it runs once wherever a pool is created.
 */
let registered = false;

export function registerTypeParsers(): void {
  if (registered) return;
  registered = true;

  // date, time and timestamp-without-zone are bare strings in PostgREST
  // ("2027-03-20", "07:00:00"); a Date here would gain a zone it never had
  // and shift every date in the UI.
  pg.types.setTypeParser(1082, (v) => v); // date
  pg.types.setTypeParser(1083, (v) => v); // time
  pg.types.setTypeParser(1114, (v) => v); // timestamp without time zone

  // timestamptz is an instant, so it keeps its zone — as an ISO 8601 string
  // rather than a Date.
  pg.types.setTypeParser(1184, (v) => (v === null ? v : new Date(v).toISOString()));

  // bigint. Only `files.size` uses it, capped at 50 MB, so Number is exact.
  pg.types.setTypeParser(20, (v) => (v === null ? v : Number(v)));
}
