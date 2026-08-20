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

/** Where each variable comes from, shown on the setup screen. */
const SOURCES: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'Supabase dashboard > Settings > API > Project URL',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'Supabase dashboard > Settings > API > anon public key',
  SUPABASE_SERVICE_ROLE_KEY:
    'Supabase dashboard > Settings > API > service_role key (server-side only)',
  SUPABASE_JWT_SECRET:
    'Supabase dashboard > Settings > API > JWT Settings > JWT Secret (32+ characters)',
  OWNER_EMAIL: 'The first Owner’s email address, e.g. owner@kmids.ac.th',
  OWNER_BACKUP_EMAIL: 'The second Owner’s email address',
  SCHOOL_EMAIL_DOMAIN: 'School domain that may sign in without an invite, e.g. kmids.ac.th',
};

export type EnvProblem = { key: string; source: string; reason: string };

function read(): Record<string, unknown> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    OWNER_EMAIL: process.env.OWNER_EMAIL,
    OWNER_BACKUP_EMAIL: process.env.OWNER_BACKUP_EMAIL ?? '',
    SCHOOL_EMAIL_DOMAIN: process.env.SCHOOL_EMAIL_DOMAIN ?? 'kmids.ac.th',
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
