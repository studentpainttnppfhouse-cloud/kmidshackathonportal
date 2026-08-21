/**
 * Where the object store lives, and what to say when it has not been set up.
 *
 * Split from `s3.ts` — like `aws/config.ts` is split from `pool.ts` — so the
 * setup screen can report a missing bucket without pulling the AWS SDK into
 * the render, and so it can be tested without a network.
 */

export interface S3Storage {
  kind: 's3';
  bucket: string;
  region: string;
  /** Set when the deployment authenticates by assuming an IAM role. */
  roleArn: string | null;
  /** Overrides the AWS endpoint — for MinIO, or S3-compatible storage. */
  endpoint: string | null;
  /** Path-style addressing, which most S3-compatible servers need. */
  forcePathStyle: boolean;
}

/**
 * Files on the local filesystem, for `npm run dev:local`.
 *
 * Development used to get its object store from the API shim, which faked
 * Supabase Storage on disk. Keeping a disk driver means the portal still runs
 * end to end — uploads included — without an AWS account.
 */
export interface LocalStorage {
  kind: 'local';
  directory: string;
}

export type StorageConfig = S3Storage | LocalStorage;

const ALIASES = {
  directory: ['FILES_DIR'],
  bucket: ['FILES_BUCKET', 'S3_BUCKET', 'AWS_S3_BUCKET', 'STORAGE_BUCKET'],
  // AWS_REGION first: it is the name the Vercel AWS integration injects, and
  // so the one the setup screen should name when it is missing.
  region: ['AWS_REGION', 'AWS_DEFAULT_REGION', 'RDS_REGION'],
  roleArn: ['AWS_ROLE_ARN', 'S3_ROLE_ARN'],
  endpoint: ['S3_ENDPOINT', 'AWS_ENDPOINT_URL_S3'],
} as const;

const SOURCES: Record<string, string> = {
  FILES_BUCKET: 'S3 console > your bucket name, e.g. hackathon-studio-files',
  AWS_REGION: 'The region the bucket is in, e.g. ap-southeast-1',
};

export interface StorageProblem {
  key: string;
  source: string;
  reason: string;
  alsoAccepts: string[];
}

type Vars = Record<string, string | undefined>;

function pick(vars: Vars, key: keyof typeof ALIASES): string | undefined {
  for (const name of ALIASES[key]) {
    const value = vars[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export function resolveStorage(
  vars: Vars = process.env,
): { config: StorageConfig; problems: [] } | { config: null; problems: StorageProblem[] } {
  // A local directory short-circuits everything else: if one is named, that is
  // plainly what was meant, and no bucket is required.
  const directory = pick(vars, 'directory');
  if (directory) return { config: { kind: 'local', directory }, problems: [] };

  const bucket = pick(vars, 'bucket');
  const region = pick(vars, 'region');
  const problems: StorageProblem[] = [];

  const require_ = (key: keyof typeof ALIASES, value: string | undefined) => {
    if (value) return;
    const name = ALIASES[key][0];
    problems.push({
      key: name,
      source: SOURCES[name] ?? '',
      reason: 'not set',
      alsoAccepts: [...ALIASES[key]].slice(1),
    });
  };

  require_('bucket', bucket);
  require_('region', region);

  if (!bucket || !region) return { config: null, problems };

  const endpoint = pick(vars, 'endpoint') ?? null;
  return {
    config: {
      kind: 's3',
      bucket,
      region,
      roleArn: pick(vars, 'roleArn') ?? null,
      endpoint,
      // Custom endpoints are almost always MinIO or similar, which cannot do
      // virtual-host addressing.
      forcePathStyle: endpoint !== null,
    },
    problems: [],
  };
}

export function storageConfigured(vars: Vars = process.env): boolean {
  return resolveStorage(vars).config !== null;
}
