import { z } from 'zod';

/**
 * Environment contract. Parsed once, eagerly, so a missing variable fails at
 * boot with a readable message instead of at 7 AM on event day.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Used to mint the PostgREST JWT. Supabase project settings > API > JWT Secret. */
  SUPABASE_JWT_SECRET: z.string().min(16),
  /** First Owner. Created at T4 on first sign-in. */
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
 * Supabase can be added through the Vercel Marketplace instead of by hand, and
 * that integration injects its own names — unprefixed (`SUPABASE_URL`), and
 * increasingly the newer key vocabulary (`SUPABASE_PUBLISHABLE_KEY`,
 * `SUPABASE_SECRET_KEY`) that is replacing anon/service_role. Reading whichever
 * name is present means a Marketplace-provisioned project works without anyone
 * hand-copying values into a second set of variables.
 */
const ALIASES: Record<string, readonly string[]> = {
  NEXT_PUBLIC_SUPABASE_URL: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'],
  NEXT_PUBLIC_SUPABASE_ANON_KEY: [
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
  ],
  SUPABASE_SERVICE_ROLE_KEY: ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'],
  SUPABASE_JWT_SECRET: ['SUPABASE_JWT_SECRET'],
  OWNER_EMAIL: ['OWNER_EMAIL'],
  OWNER_BACKUP_EMAIL: ['OWNER_BACKUP_EMAIL'],
  SCHOOL_EMAIL_DOMAIN: ['SCHOOL_EMAIL_DOMAIN'],
};

/** Where each value comes from, shown on the setup screen. */
const SOURCES: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'Supabase > Settings > API > Project URL',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'Supabase > Settings > API > anon public (or publishable) key',
  SUPABASE_SERVICE_ROLE_KEY:
    'Supabase > Settings > API > service_role (or secret) key — server-side only',
  SUPABASE_JWT_SECRET:
    'Supabase > Settings > API > JWT Settings > JWT Secret. The Vercel integration does not always inject this one — copy it across by hand.',
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

/**
 * First non-empty value among a key's accepted names.
 *
 * The lookup is dynamic, which is fine because nothing in this module runs in
 * the browser — client code receives the public values as props instead (see
 * `publicSupabaseConfig`). Next only inlines statically-written
 * `process.env.NEXT_PUBLIC_*` reads into client bundles, and a dynamic read
 * would silently resolve to undefined there.
 */
function pick(key: string): string | undefined {
  for (const name of ALIASES[key] ?? [key]) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function read(): Record<string, unknown> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: pick('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: pick('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: pick('SUPABASE_SERVICE_ROLE_KEY'),
    SUPABASE_JWT_SECRET: pick('SUPABASE_JWT_SECRET'),
    OWNER_EMAIL: pick('OWNER_EMAIL'),
    OWNER_BACKUP_EMAIL: pick('OWNER_BACKUP_EMAIL') ?? '',
    SCHOOL_EMAIL_DOMAIN: pick('SCHOOL_EMAIL_DOMAIN') ?? 'kmids.ac.th',
  };
}

/**
 * The same check `env()` runs, but it reports instead of throwing — so the app
 * can render a screen naming the variables rather than a bare digest. A
 * misconfigured deploy is the one failure a first-time deployer will hit, and
 * §3 of the brief says never show a generic error.
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
        issue.code === 'invalid_type' && issue.received === 'undefined' ? 'not set' : issue.message,
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

/**
 * The two values the browser is allowed to hold, resolved on the server and
 * handed to client components as props.
 *
 * These cannot be read from `process.env` in the browser: only literal
 * `NEXT_PUBLIC_*` reads are compiled into the client bundle, so a project whose
 * URL arrived as `SUPABASE_URL` would leave the collaboration client pointed at
 * an empty string and silently drop every document into solo mode.
 */
export function publicSupabaseConfig(): { url: string; anonKey: string } {
  const e = env();
  return { url: e.NEXT_PUBLIC_SUPABASE_URL, anonKey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY };
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
