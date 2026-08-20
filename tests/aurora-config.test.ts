import { describe, expect, it } from 'vitest';
import { auroraConfigured, resolveAurora } from '@/lib/aws/config';

/**
 * The Aurora connection details arrive from `vercel env pull`, under whichever
 * names the AWS integration chose. These tests pin the names that must work
 * and the report a first-time deployer sees when one is absent.
 */

const IAM = {
  RDS_HOSTNAME: 'db.cluster-abc123.ap-southeast-1.rds.amazonaws.com',
  RDS_DATABASE: 'hackathon',
  RDS_USERNAME: 'portal',
  AWS_REGION: 'ap-southeast-1',
  AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/vercel-portal',
};

describe('resolveAurora', () => {
  it('reads a complete IAM setup', () => {
    const { config, problems } = resolveAurora(IAM);
    expect(problems).toEqual([]);
    expect(config).toMatchObject({
      host: IAM.RDS_HOSTNAME,
      port: 5432,
      database: 'hackathon',
      user: 'portal',
      region: 'ap-southeast-1',
      auth: { kind: 'iam', roleArn: IAM.AWS_ROLE_ARN },
    });
  });

  it('prefers IAM over a password when both are available', () => {
    const { config } = resolveAurora({ ...IAM, RDS_PASSWORD: 'hunter2' });
    // A 15-minute token beats a secret that lives in the dashboard forever.
    expect(config?.auth.kind).toBe('iam');
  });

  it('falls back to a password when there is no role to assume', () => {
    const { AWS_ROLE_ARN: _role, AWS_REGION: _region, ...rest } = IAM;
    const { config, problems } = resolveAurora({ ...rest, RDS_PASSWORD: 'hunter2' });
    expect(problems).toEqual([]);
    expect(config?.auth).toEqual({ kind: 'password', password: 'hunter2' });
  });

  it('accepts the alternative names an integration may inject', () => {
    const { config, problems } = resolveAurora({
      PGHOST: IAM.RDS_HOSTNAME,
      POSTGRES_DATABASE: 'hackathon',
      PGUSER: 'portal',
      PGPASSWORD: 'hunter2',
      PGPORT: '6543',
    });
    expect(problems).toEqual([]);
    expect(config).toMatchObject({ host: IAM.RDS_HOSTNAME, port: 6543, user: 'portal' });
  });

  it('unpacks a single connection URI', () => {
    const { config, problems } = resolveAurora({
      AURORA_DATABASE_URL: 'postgresql://portal:hunter2@db.example.com:5433/hackathon',
    });
    expect(problems).toEqual([]);
    expect(config).toMatchObject({
      host: 'db.example.com',
      port: 5433,
      database: 'hackathon',
      user: 'portal',
      auth: { kind: 'password', password: 'hunter2' },
    });
  });

  it('lets an individual variable override the URI it also appears in', () => {
    const { config } = resolveAurora({
      AURORA_DATABASE_URL: 'postgresql://portal:hunter2@db.example.com:5433/hackathon',
      RDS_DATABASE: 'hackathon_staging',
    });
    expect(config?.database).toBe('hackathon_staging');
  });

  it('names every missing variable, not just the first', () => {
    const { config, problems } = resolveAurora({});
    expect(config).toBeNull();
    expect(problems.map((p) => p.key)).toEqual([
      'RDS_HOSTNAME',
      'RDS_DATABASE',
      'RDS_USERNAME',
      'AWS_ROLE_ARN',
    ]);
  });

  it('tells you the other names a value is accepted under', () => {
    const { problems } = resolveAurora({});
    const host = problems.find((p) => p.key === 'RDS_HOSTNAME');
    expect(host?.alsoAccepts).toContain('PGHOST');
    expect(host?.source).toMatch(/Endpoint/);
  });

  it('requires a region alongside a role, because the token is signed for one', () => {
    const { AWS_REGION: _region, ...noRegion } = IAM;
    const { config, problems } = resolveAurora(noRegion);
    expect(config).toBeNull();
    expect(problems.map((p) => p.key)).toContain('AWS_REGION');
  });

  it('does not require a region for password auth', () => {
    const { AWS_ROLE_ARN: _role, AWS_REGION: _region, ...rest } = IAM;
    expect(auroraConfigured({ ...rest, RDS_PASSWORD: 'hunter2' })).toBe(true);
  });

  it('rejects a port that is not a number', () => {
    const { problems } = resolveAurora({ ...IAM, RDS_PORT: 'five-thousand' });
    expect(problems.map((p) => p.key)).toContain('RDS_PORT');
  });

  it('reports a malformed URI rather than throwing', () => {
    const { config, problems } = resolveAurora({ AURORA_DATABASE_URL: 'not a url' });
    expect(config).toBeNull();
    expect(problems[0]?.key).toBe('AURORA_DATABASE_URL');
  });

  it('treats the app as un-configured when nothing is set', () => {
    expect(auroraConfigured({})).toBe(false);
  });
});
