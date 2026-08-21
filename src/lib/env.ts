import { z } from 'zod';
import { resolveAurora, type AuroraProblem } from '@/lib/aws/config';
import { resolveStorage, type StorageProblem } from '@/lib/storage/config';

/**
 * Environment contract. Parsed once, eagerly, so a missing variable fails at
 * boot with a readable message instead of at 7 AM on event day.
 *
 * The database and bucket settings are not repeated here — `aws/config.ts` and
 * `storage/config.ts` own those, because both are also read from scripts that
 * run outside Next. This module owns the handful of values that are purely the
 * app's, and `envProblems()` gathers all three into one list for the setup
 * screen.
 */
const schema = z.object({
  /** First Owner. Created at T4 on first sign-in. */
  OWNER_EMAIL: z.string().email(),
  /** Second Owner — two must always exist so one graduating student is not a
   *  single point of failure. */
  OWNER_BACKUP_EMAIL: z.string().email().optional().or(z.literal('')),
  /** School domain permitted to sign in without an explicit invite. */
  SCHOOL_EMAIL_DOMAIN: z.string().default('kmids.ac.th'),
});

export type Env = z.infer<typeof schema>;

/** Where each value comes from, shown on the setup screen. */
const SOURCES: Record<string, string> = {
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

function read(): Record<string, unknown> {
  return {
    OWNER_EMAIL: process.env.OWNER_EMAIL,
    OWNER_BACKUP_EMAIL: process.env.OWNER_BACKUP_EMAIL ?? '',
    SCHOOL_EMAIL_DOMAIN: process.env.SCHOOL_EMAIL_DOMAIN ?? 'kmids.ac.th',
  };
}

function ownProblems(): EnvProblem[] {
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
      alsoAccepts: [],
    });
  }
  return problems;
}

/** The two config modules report in the same shape; this just relabels them. */
function adopt(problems: (AuroraProblem | StorageProblem)[]): EnvProblem[] {
  return problems.map((p) => ({
    key: p.key,
    source: p.source,
    reason: p.reason,
    alsoAccepts: p.alsoAccepts,
  }));
}

/**
 * Everything a deployment is still missing, reported rather than thrown — so
 * the app can render a screen naming the variables instead of a bare digest.
 * A misconfigured deploy is the one failure a first-time deployer will hit,
 * and §3 of the brief says never show a generic error.
 *
 * Database first: without it nothing else matters.
 */
export function envProblems(): EnvProblem[] {
  return [
    ...adopt(resolveAurora().problems),
    ...adopt(resolveStorage().problems),
    ...ownProblems(),
  ];
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
