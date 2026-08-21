import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envProblems } from '@/lib/env';

/**
 * Every name the diagnostic reads, listed so the fixture can clear ones that
 * happen to be set on a developer's machine — a stray DATABASE_URL would
 * otherwise make these pass for the wrong reason.
 */
const KEYS = [
  'OWNER_EMAIL',
  'OWNER_BACKUP_EMAIL',
  'SCHOOL_EMAIL_DOMAIN',
  'DATABASE_URL', 'AURORA_DATABASE_URL', 'RDS_DATABASE_URL',
  'POSTGRES_URL', 'POSTGRESQL_URL', 'PG_CONNECTION_STRING',
  'RDS_HOSTNAME', 'RDS_HOST', 'AURORA_HOST', 'PGHOST', 'POSTGRES_HOST',
  'RDS_PORT', 'PGPORT', 'POSTGRES_PORT',
  'RDS_DATABASE', 'RDS_DB_NAME', 'PGDATABASE', 'POSTGRES_DATABASE',
  'RDS_USERNAME', 'RDS_USER', 'PGUSER', 'POSTGRES_USER',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'RDS_REGION',
  'AWS_ROLE_ARN', 'RDS_ROLE_ARN',
  'RDS_PASSWORD', 'PGPASSWORD', 'POSTGRES_PASSWORD',
] as const;

/** The shortest working configuration: one URI and the Owners. */
const COMPLETE: Record<string, string> = {
  DATABASE_URL: 'postgresql://portal:secret@db.example.com:5432/hackathon',
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

  it('says nothing about Supabase, which the app no longer uses', () => {
    for (const k of KEYS) delete process.env[k];
    expect(JSON.stringify(envProblems()).toLowerCase()).not.toContain('supabase');
  });

  it('asks for one connection URI rather than five separate variables', () => {
    for (const k of KEYS) delete process.env[k];
    const problem = envProblems()[0];
    expect(problem?.key).toBe('DATABASE_URL');
    expect(problem?.alsoAccepts).toContain('POSTGRES_URL');
  });

  it('reports the database before anything else, since nothing works without it', () => {
    for (const k of KEYS) delete process.env[k];
    expect(keys()[0]).toBe('DATABASE_URL');
  });

  it('names every variable that is missing, so a bad deploy is self-explaining', () => {
    delete process.env.DATABASE_URL;
    delete process.env.OWNER_EMAIL;
    expect(keys()).toEqual(['DATABASE_URL', 'OWNER_EMAIL']);
  });

  it('treats an empty string as not set', () => {
    process.env.OWNER_EMAIL = '';
    expect(keys()).toContain('OWNER_EMAIL');
  });

  it('rejects an owner address that is not an email', () => {
    process.env.OWNER_EMAIL = 'not-an-email';
    const problem = envProblems().find((p) => p.key === 'OWNER_EMAIL');
    expect(problem).toBeDefined();
    expect(problem?.reason).not.toBe('not set');
  });

  it('does not require the backup owner to be set', () => {
    delete process.env.OWNER_BACKUP_EMAIL;
    expect(keys()).not.toContain('OWNER_BACKUP_EMAIL');
  });

  it('defaults the school domain rather than demanding it', () => {
    delete process.env.SCHOOL_EMAIL_DOMAIN;
    expect(keys()).not.toContain('SCHOOL_EMAIL_DOMAIN');
  });
});

describe('the names other hosts and integrations inject', () => {
  it('accepts what a linked Render or Neon instance sets', () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = 'postgresql://portal:secret@db.example.com:5432/hackathon';
    expect(keys()).toEqual([]);
  });

  it('accepts the five separate RDS variables with an IAM role', () => {
    delete process.env.DATABASE_URL;
    process.env.RDS_HOSTNAME = 'hs.cluster-abc.ap-southeast-1.rds.amazonaws.com';
    process.env.RDS_DATABASE = 'hackathon';
    process.env.RDS_USERNAME = 'portal';
    process.env.AWS_REGION = 'ap-southeast-1';
    process.env.AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/hackathon-studio';
    expect(keys()).toEqual([]);
  });

  it('accepts the PG* names a local Postgres uses, with no password', () => {
    delete process.env.DATABASE_URL;
    process.env.PGHOST = 'localhost';
    process.env.PGDATABASE = 'hackathon';
    process.env.PGUSER = 'postgres';
    expect(keys()).toEqual([]);
  });
});
