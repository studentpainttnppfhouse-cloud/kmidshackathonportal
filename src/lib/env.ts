import { z } from 'zod';

/**
 * The environment contract.
 *
 * Deliberately short. The portal needs a database to talk to and it needs to
 * know who the Owners are; everything else has a sensible default.
 *
 * `env()` throws when something required is missing, but `envProblems()`
 * reports the same check without throwing, so a diagnostic can name the
 * variable and say where its value comes from. `/api/health/db` is what reads
 * it — deliberately a single endpoint rather than a gate above every route,
 * because a gate that is wrong about one alias hides an app that works.
 */
const schema = z.object({
  /** The full PostgreSQL connection URI. */
  DATABASE_URL: z.string().min(1).refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
      } catch {
        return false;
      }
    },
    { message: 'must be a postgresql:// connection URI' },
  ),
  /** First Owner. Becomes T4 on first sign-in. */
  OWNER_EMAIL: z.string().email(),
  /** Second Owner — two must always exist so one graduating student is not a
   *  single point of failure. */
  OWNER_BACKUP_EMAIL: z.string().email().optional().or(z.literal('')),
  /** School domain permitted to sign in without an explicit invite. */
  SCHOOL_EMAIL_DOMAIN: z.string().default('kmids.ac.th'),
});

export type Env = z.infer<typeof schema>;

/**
 * Names each value may arrive under, most-preferred first.
 *
 * Render sets `DATABASE_URL` on a linked Postgres instance, but a cluster
 * added by hand — an RDS endpoint, say — is just as likely to be pasted in
 * under one of the other conventional names. Reading whichever is present
 * means nobody has to copy a value into a second variable to make the app see
 * it.
 */
const ALIASES: Record<string, readonly string[]> = {
  DATABASE_URL: [
    'DATABASE_URL',
    'POSTGRES_URL',
    'POSTGRESQL_URL',
    'RDS_DATABASE_URL',
    'PG_CONNECTION_STRING',
  ],
  OWNER_EMAIL: ['OWNER_EMAIL'],
  OWNER_BACKUP_EMAIL: ['OWNER_BACKUP_EMAIL'],
  SCHOOL_EMAIL_DOMAIN: ['SCHOOL_EMAIL_DOMAIN'],
};

/** Where each value comes from, shown on the setup screen. */
const SOURCES: Record<string, string> = {
  DATABASE_URL:
    'Render → your Postgres → Internal Database URL, or an RDS endpoint written out in full: ' +
    'postgresql://user:password@host:5432/dbname',
  OWNER_EMAIL: 'The first Owner’s email address, e.g. owner@kmids.ac.th',
  OWNER_BACKUP_EMAIL: 'The second Owner’s email address',
  SCHOOL_EMAIL_DOMAIN: 'School domain that may sign in without an invite, e.g. kmids.ac.th',
};

export type EnvProblem = {
  key: string;
  source: string;
  reason: string;
  /** Other names this value is accepted under, so the screen can say so. */
  alsoAccepts: string[];
};

/** First non-empty value among a key's accepted names. */
function pick(key: string): string | undefined {
  for (const name of ALIASES[key] ?? [key]) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function read(): Record<string, unknown> {
  return {
    DATABASE_URL: pick('DATABASE_URL'),
    OWNER_EMAIL: pick('OWNER_EMAIL'),
    OWNER_BACKUP_EMAIL: pick('OWNER_BACKUP_EMAIL') ?? '',
    SCHOOL_EMAIL_DOMAIN: pick('SCHOOL_EMAIL_DOMAIN') ?? 'kmids.ac.th',
  };
}

/**
 * The same check `env()` runs, but it reports instead of throwing — so the app
 * can render a screen naming the variables rather than a bare digest. §3 of
 * the brief says never show a generic error, and this is where that starts.
 */
export function envProblems(): EnvProblem[] {
  const parsed = schema.safeParse(read());
  if (parsed.success) return [];

  const seen = new Set<string>();
  const problems: EnvProblem[] = [];
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    problems.push({
      key,
      source: SOURCES[key] ?? '',
      reason:
        issue.code === 'invalid_type' && issue.received === 'undefined'
          ? 'not set'
          : issue.message,
      alsoAccepts: (ALIASES[key] ?? []).slice(1),
    });
  }
  return problems;
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(read());

  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `Missing or invalid environment variables: ${missing}. ` +
        'Copy .env.example to .env.local and fill it in — see README.md.',
    );
  }

  cached = parsed.data;
  return cached;
}

/** The connection URI, for the pool and for the migration script. */
export function databaseUrl(): string {
  return env().DATABASE_URL;
}

/** The school domain, lowercased and without a leading @. */
export function schoolDomain(): string {
  return env().SCHOOL_EMAIL_DOMAIN.replace(/^@/, '').toLowerCase();
}

export function ownerEmails(): string[] {
  const e = env();
  return [e.OWNER_EMAIL, e.OWNER_BACKUP_EMAIL]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());
}

/** Test seam: forget the parsed values so a new environment is read. */
export function resetEnvCache(): void {
  cached = null;
}
