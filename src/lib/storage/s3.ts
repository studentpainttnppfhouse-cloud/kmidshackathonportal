import 'server-only';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { awsCredentialsProvider } from '@vercel/functions/oidc';
import type { S3Storage } from './config';
import type { StorageError, StoredObject } from './types';

/**
 * Uploaded files, on S3 instead of Supabase Storage.
 *
 * Authentication follows the database: on Vercel the deployment exchanges its
 * OIDC token for the same IAM role that signs the RDS token, so there is no
 * long-lived key here either. Off Vercel the SDK's usual credential chain
 * applies, which is what a laptop or another host will have.
 *
 * Objects are never public. Supabase's `getPublicUrl` handed out a permanent
 * unguessable link, which meant a file shared once was shared forever; a
 * pre-signed URL expires, so a link that leaks stops working.
 */

const globalForS3 = globalThis as unknown as { s3?: S3Client };

function s3(config: S3Storage): S3Client {
  if (globalForS3.s3) return globalForS3.s3;

  const client = new S3Client({
    region: config.region,
    ...(config.roleArn ? { credentials: awsCredentialsProvider({ roleArn: config.roleArn }) } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });

  globalForS3.s3 = client;
  return client;
}

/** How long a download link stays good for. Long enough to click, not to keep. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function put(
  config: S3Storage,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<{ error: StorageError | null }> {
  try {
    await s3(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { error: null };
  } catch (error) {
    return { error: { message: (error as Error).message } };
  }
}

/** Best-effort cleanup — a failure here must not fail the caller's action. */
export async function remove(config: S3Storage, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await s3(config).send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    );
  } catch (error) {
    console.error('[storage] could not remove objects:', (error as Error).message);
  }
}

export async function list(
  config: S3Storage,
  prefix: string,
  limit: number,
): Promise<StoredObject[]> {
  const result = await s3(config).send(
    new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: limit }),
  );
  return (result.Contents ?? []).map((object) => ({
    name: object.Key ?? '',
    size: object.Size ?? null,
    updated_at: object.LastModified?.toISOString() ?? null,
  }));
}

/** A time-limited download link for one object. */
export async function signedUrl(config: S3Storage, key: string): Promise<string> {
  return getSignedUrl(
    s3(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}
