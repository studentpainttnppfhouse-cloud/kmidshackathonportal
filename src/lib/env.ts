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

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    OWNER_EMAIL: process.env.OWNER_EMAIL,
    OWNER_BACKUP_EMAIL: process.env.OWNER_BACKUP_EMAIL ?? '',
    SCHOOL_EMAIL_DOMAIN: process.env.SCHOOL_EMAIL_DOMAIN ?? 'kmids.ac.th',
  });

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
