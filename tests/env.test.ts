import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envProblems } from '@/lib/env';

/** Every name the environment contract reads, under any of its spellings. */
const KEYS = [
  'DATABASE_URL',
  'OWNER_EMAIL',
  'OWNER_BACKUP_EMAIL',
  'SCHOOL_EMAIL_DOMAIN',
  // The other names a connection URI is accepted under.
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'RDS_DATABASE_URL',
  'PG_CONNECTION_STRING',
] as const;

const URI = 'postgresql://portal:secret@db.example.com:5432/hackathon';

const COMPLETE: Record<string, string> = {
  DATABASE_URL: URI,
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
    else process.env[k] = saved[k] as string;
  }
});

describe('envProblems', () => {
  it('reports nothing when everything is set', () => {
    expect(envProblems()).toEqual([]);
  });

  it('names a missing variable rather than throwing', () => {
    delete process.env.DATABASE_URL;

    const problems = envProblems();
    expect(problems).toHaveLength(1);
    expect(problems[0]?.key).toBe('DATABASE_URL');
    expect(problems[0]?.reason).toBe('not set');
  });

  it('tells the reader what else the value is accepted as', () => {
    delete process.env.DATABASE_URL;
    expect(envProblems()[0]?.alsoAccepts).toContain('POSTGRES_URL');
  });

  it('says where to find the value', () => {
    delete process.env.DATABASE_URL;
    expect(envProblems()[0]?.source).toMatch(/Render|postgresql:\/\//);
  });

  it('accepts a URI that arrived under another name', () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = URI;
    expect(envProblems()).toEqual([]);
  });

  it('prefers DATABASE_URL over the aliases', () => {
    process.env.POSTGRES_URL = 'postgresql://other@elsewhere:5432/other';
    expect(envProblems()).toEqual([]);
  });

  it('treats an empty string as absent', () => {
    process.env.DATABASE_URL = '';
    expect(envProblems().map((p) => p.key)).toEqual(['DATABASE_URL']);
  });

  it('rejects a connection string that is not a postgres URI', () => {
    process.env.DATABASE_URL = 'https://example.com/db';
    expect(envProblems()[0]?.reason).toMatch(/postgresql/);
  });

  it('rejects an owner address that is not an email', () => {
    process.env.OWNER_EMAIL = 'not-an-address';
    expect(envProblems().map((p) => p.key)).toEqual(['OWNER_EMAIL']);
  });

  it('allows the backup owner to be left empty', () => {
    process.env.OWNER_BACKUP_EMAIL = '';
    expect(envProblems()).toEqual([]);
  });

  it('defaults the school domain', () => {
    delete process.env.SCHOOL_EMAIL_DOMAIN;
    expect(envProblems()).toEqual([]);
  });

  it('reports every missing variable at once, not just the first', () => {
    delete process.env.DATABASE_URL;
    delete process.env.OWNER_EMAIL;
    expect(envProblems().map((p) => p.key).sort()).toEqual(['DATABASE_URL', 'OWNER_EMAIL']);
  });
});
