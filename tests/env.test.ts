import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { envProblems } from '@/lib/env';

/**
 * Every name the setup screen reads, across all three config modules. Listed
 * here so the fixture can clear names that happen to be set in the real
 * environment — a stray AWS_REGION on a developer's machine would otherwise
 * make these pass for the wrong reason.
 */
const KEYS = [
  'OWNER_EMAIL',
  'OWNER_BACKUP_EMAIL',
  'SCHOOL_EMAIL_DOMAIN',
  // Aurora
  'RDS_HOSTNAME', 'RDS_HOST', 'AURORA_HOST', 'PGHOST', 'POSTGRES_HOST',
  'RDS_PORT', 'PGPORT', 'POSTGRES_PORT',
  'RDS_DATABASE', 'RDS_DB_NAME', 'PGDATABASE', 'POSTGRES_DATABASE',
  'RDS_USERNAME', 'RDS_USER', 'PGUSER', 'POSTGRES_USER',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'RDS_REGION',
  'AWS_ROLE_ARN', 'RDS_ROLE_ARN',
  'RDS_PASSWORD', 'PGPASSWORD', 'POSTGRES_PASSWORD',
  'AURORA_DATABASE_URL', 'RDS_DATABASE_URL',
  // Object storage
  'FILES_BUCKET', 'S3_BUCKET', 'AWS_S3_BUCKET', 'STORAGE_BUCKET',
  'S3_ENDPOINT', 'AWS_ENDPOINT_URL_S3', 'S3_ROLE_ARN',
] as const;

const COMPLETE: Record<string, string> = {
  OWNER_EMAIL: 'owner@kmids.ac.th',
  OWNER_BACKUP_EMAIL: 'backup@kmids.ac.th',
  SCHOOL_EMAIL_DOMAIN: 'kmids.ac.th',
  RDS_HOSTNAME: 'hs.cluster-abc.ap-southeast-1.rds.amazonaws.com',
  RDS_DATABASE: 'hackathon',
  RDS_USERNAME: 'portal',
  AWS_REGION: 'ap-southeast-1',
  AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/vercel-hackathon-studio',
  FILES_BUCKET: 'hackathon-studio-files',
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
    const text = JSON.stringify(envProblems()).toLowerCase();
    expect(text).not.toContain('supabase');
  });

  it('names every variable that is missing, so a bad deploy is self-explaining', () => {
    delete process.env.RDS_HOSTNAME;
    delete process.env.FILES_BUCKET;
    delete process.env.OWNER_EMAIL;

    expect(keys()).toEqual(['RDS_HOSTNAME', 'FILES_BUCKET', 'OWNER_EMAIL']);
  });

  it('reports the database first, since nothing else matters without it', () => {
    for (const k of KEYS) delete process.env[k];
    expect(keys()[0]).toBe('RDS_HOSTNAME');
  });

  it('gives each problem a place to find the value', () => {
    delete process.env.FILES_BUCKET;
    const problem = envProblems().find((p) => p.key === 'FILES_BUCKET');
    expect(problem?.source).toContain('bucket');
    expect(problem?.reason).toBe('not set');
  });

  it('lists the other names a value is accepted under', () => {
    delete process.env.FILES_BUCKET;
    const problem = envProblems().find((p) => p.key === 'FILES_BUCKET');
    expect(problem?.alsoAccepts).toContain('S3_BUCKET');
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

describe('variable names injected by the AWS and Postgres integrations', () => {
  it('accepts a whole connection URI in place of the separate values', () => {
    delete process.env.RDS_HOSTNAME;
    delete process.env.RDS_DATABASE;
    delete process.env.RDS_USERNAME;
    process.env.AURORA_DATABASE_URL = 'postgresql://portal@hs.rds.amazonaws.com:5432/hackathon';

    expect(keys()).toEqual([]);
  });

  it('accepts the PG* names a local Postgres uses', () => {
    delete process.env.RDS_HOSTNAME;
    delete process.env.RDS_DATABASE;
    delete process.env.RDS_USERNAME;
    delete process.env.AWS_ROLE_ARN;
    process.env.PGHOST = 'localhost';
    process.env.PGDATABASE = 'hackathon';
    process.env.PGUSER = 'postgres';
    process.env.PGPASSWORD = 'secret';

    expect(keys()).toEqual([]);
  });

  it('takes a password when there is no IAM role to assume', () => {
    delete process.env.AWS_ROLE_ARN;
    expect(keys()).toContain('AWS_ROLE_ARN');

    process.env.RDS_PASSWORD = 'secret';
    expect(keys()).toEqual([]);
  });

  it('accepts the bucket under the names other integrations inject', () => {
    delete process.env.FILES_BUCKET;
    process.env.AWS_S3_BUCKET = 'hackathon-studio-files';
    expect(keys()).toEqual([]);
  });
});
