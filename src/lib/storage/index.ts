import 'server-only';
import { resolveStorage, type StorageConfig } from './config';
import type { StorageError, StoredObject } from './types';
import * as s3 from './s3';
import * as local from './local';

export type { StorageError, StoredObject } from './types';

/**
 * Uploaded files, behind one interface with two drivers underneath.
 *
 * S3 in a deployment; a directory on disk when `FILES_DIR` is set, which is
 * what `npm run dev:local` uses so the portal runs end to end without an AWS
 * account. Callers never pick — they just store and fetch files.
 */

export class StorageNotConfiguredError extends Error {
  constructor(readonly problems: { key: string; reason: string }[]) {
    super(
      `File storage is not configured: ${problems.map((p) => `${p.key} ${p.reason}`).join(', ')}. ` +
        'See README.md.',
    );
    this.name = 'StorageNotConfiguredError';
  }
}

function config(): StorageConfig {
  const resolved = resolveStorage();
  if (!resolved.config) throw new StorageNotConfiguredError(resolved.problems);
  return resolved.config;
}

export async function uploadObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<{ error: StorageError | null }> {
  const c = config();
  return c.kind === 'local' ? local.put(c, key, body) : s3.put(c, key, body, contentType);
}

export async function removeObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const c = config();
  return c.kind === 'local' ? local.remove(c, keys) : s3.remove(c, keys);
}

export async function listObjects(prefix = '', limit = 1000): Promise<StoredObject[]> {
  const c = config();
  return c.kind === 'local' ? local.list(c, prefix, limit) : s3.list(c, prefix, limit);
}

/**
 * A link the browser can fetch this object with.
 *
 * On S3 that is a pre-signed URL that expires; locally it is a route that
 * checks the session. Either way a file is never simply public — Supabase's
 * `getPublicUrl` handed out a permanent link, so anything shared once stayed
 * shared forever.
 */
export async function signedUrlFor(key: string): Promise<string> {
  const c = config();
  if (c.kind === 'local') {
    return `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  return s3.signedUrl(c, key);
}

/** Which bucket or directory files are in, for the export manifest. */
export function storageLocation(): string | null {
  const resolved = resolveStorage();
  if (!resolved.config) return null;
  return resolved.config.kind === 'local' ? resolved.config.directory : resolved.config.bucket;
}

/** The local driver's file reader, for the route that serves them. */
export async function readLocalObject(key: string): Promise<Uint8Array | null> {
  const c = config();
  return c.kind === 'local' ? local.read(c, key) : null;
}
