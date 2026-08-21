import { describe, expect, it } from 'vitest';
import { resolveStorage, storageConfigured } from '@/lib/storage/config';

describe('storage configuration', () => {
  it('resolves a bucket and region', () => {
    const result = resolveStorage({ FILES_BUCKET: 'hs-files', AWS_REGION: 'ap-southeast-1' });
    expect(result.config).toMatchObject({
      bucket: 'hs-files',
      region: 'ap-southeast-1',
      forcePathStyle: false,
    });
  });

  it('accepts the names other integrations inject', () => {
    const result = resolveStorage({ S3_BUCKET: 'hs-files', AWS_DEFAULT_REGION: 'eu-west-1' });
    expect(result.config).toMatchObject({ kind: 's3', bucket: 'hs-files', region: 'eu-west-1' });
  });

  it('names what is missing instead of throwing', () => {
    const result = resolveStorage({});
    expect(result.config).toBeNull();
    expect(result.problems.map((p) => p.key)).toEqual(['FILES_BUCKET', 'AWS_REGION']);
    expect(result.problems[0]!.alsoAccepts).toContain('S3_BUCKET');
  });

  it('switches to path-style addressing for an S3-compatible endpoint', () => {
    const result = resolveStorage({
      FILES_BUCKET: 'hs-files',
      AWS_REGION: 'us-east-1',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
    });
    expect(result.config).toMatchObject({
      forcePathStyle: true,
      endpoint: 'http://127.0.0.1:9000',
    });
  });

  it('takes a local directory instead, for development without AWS', () => {
    const result = resolveStorage({ FILES_DIR: '.storage' });
    expect(result.config).toEqual({ kind: 'local', directory: '.storage' });
    expect(result.problems).toEqual([]);
  });

  it('reports configured only when both values are present', () => {
    expect(storageConfigured({ FILES_BUCKET: 'b', AWS_REGION: 'r' })).toBe(true);
    expect(storageConfigured({ FILES_BUCKET: 'b' })).toBe(false);
  });
});
