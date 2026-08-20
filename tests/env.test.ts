import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envProblems } from '@/lib/env';

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'OWNER_EMAIL',
  'OWNER_BACKUP_EMAIL',
  'SCHOOL_EMAIL_DOMAIN',
  // The names a Vercel Marketplace Supabase project arrives under.
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
] as const;

const COMPLETE: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_JWT_SECRET: 'a-secret-of-at-least-32-characters-long',
  OWNER_EMAIL: 'owner@kmids.ac.th',
  OWNER_BACKUP_EMAIL: 'backup@kmids.ac.th',
  SCHOOL_EMAIL_DOMAIN: 'kmids.ac.th',
};

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  // Assigning undefined to process.env stores the string "undefined", which a
  // presence check would happily accept — so absent names are deleted, not set.
  for (const k of KEYS) {
    saved[k] = process.env[k];
    if (COMPLETE[k] === undefined) delete process.env[k];
    else process.env[k] = COMPLETE[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function keys() {
  return envProblems().map((p) => p.key);
}

describe('envProblems', () => {
  it('reports nothing when the environment is complete', () => {
    expect(envProblems()).toEqual([]);
  });

  it('names every variable that is missing, so a bad deploy is self-explaining', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.OWNER_EMAIL;

    expect(keys()).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OWNER_EMAIL',
    ]);
  });

  it('says "not set" for an absent variable and why for a malformed one', () => {
    delete process.env.OWNER_EMAIL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'demo.supabase.co'; // no scheme

    const problems = envProblems();
    expect(problems.find((p) => p.key === 'OWNER_EMAIL')?.reason).toBe('not set');
    expect(problems.find((p) => p.key === 'NEXT_PUBLIC_SUPABASE_URL')?.reason).not.toBe('not set');
  });

  it('catches a JWT secret that is present but too short to sign with', () => {
    process.env.SUPABASE_JWT_SECRET = 'short';
    expect(keys()).toEqual(['SUPABASE_JWT_SECRET']);
  });

  it('lists each variable once, however many rules it breaks', () => {
    process.env.OWNER_EMAIL = 'not-an-email';
    expect(keys().filter((k) => k === 'OWNER_EMAIL')).toHaveLength(1);
  });

  it('treats the two optional variables as optional', () => {
    delete process.env.OWNER_BACKUP_EMAIL;
    delete process.env.SCHOOL_EMAIL_DOMAIN;
    expect(envProblems()).toEqual([]);
  });

  it('points at where each value comes from', () => {
    delete process.env.SUPABASE_JWT_SECRET;
    expect(envProblems()[0]?.source).toContain('JWT Secret');
  });
});

describe('Vercel Marketplace variable names', () => {
  it('accepts the unprefixed names the integration injects', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = 'https://demo.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SECRET_KEY = 'secret-key';

    expect(envProblems()).toEqual([]);
  });

  it('accepts the newer publishable/secret key vocabulary', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_abc';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_abc';

    expect(envProblems()).toEqual([]);
  });

  it('prefers the canonical name when both are set', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://canonical.supabase.co';
    process.env.SUPABASE_URL = 'https://alias.supabase.co';

    const { publicSupabaseConfig } = await import('@/lib/env');
    expect(publicSupabaseConfig().url).toBe('https://canonical.supabase.co');
  });

  it('ignores an alias set to the empty string', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_URL = '';

    expect(envProblems().map((p) => p.key)).toEqual(['NEXT_PUBLIC_SUPABASE_URL']);
  });

  it('tells the setup screen which other names it would have accepted', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(envProblems()[0]?.alsoAccepts).toEqual(['SUPABASE_URL']);
  });

  it('offers no alias for the JWT secret, which must be copied by hand', () => {
    delete process.env.SUPABASE_JWT_SECRET;
    expect(envProblems()[0]?.alsoAccepts).toEqual([]);
    expect(envProblems()[0]?.source).toContain('by hand');
  });
});
