import 'server-only';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { LocalStorage } from './config';
import type { StorageError, StoredObject } from './types';

/**
 * Files on disk, for local development.
 *
 * Keys are the same slash-separated paths S3 uses, mapped onto directories.
 * Every key is resolved against the root and checked before use, so a crafted
 * name like `../../etc/passwd` cannot escape it — a filename reaches this
 * module from an upload form, and path traversal is the obvious way to abuse
 * that.
 */

function safePath(config: LocalStorage, key: string): string {
  const root = resolve(config.directory);
  const full = resolve(join(root, normalize(key)));
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`Refusing to touch "${key}": outside the storage directory`);
  }
  return full;
}

export async function put(
  config: LocalStorage,
  key: string,
  body: Uint8Array,
): Promise<{ error: StorageError | null }> {
  try {
    const path = safePath(config, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { error: null };
  } catch (error) {
    return { error: { message: (error as Error).message } };
  }
}

export async function remove(config: LocalStorage, keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await rm(safePath(config, key), { force: true });
    } catch (error) {
      console.error('[storage] could not remove', key, (error as Error).message);
    }
  }
}

export async function list(
  config: LocalStorage,
  prefix: string,
  limit: number,
): Promise<StoredObject[]> {
  const root = resolve(config.directory);
  const found: StoredObject[] = [];

  async function walk(directory: string): Promise<void> {
    if (found.length >= limit) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return; // Nothing uploaded yet.
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const key = full.slice(root.length + 1).split(sep).join('/');
      if (!key.startsWith(prefix)) continue;
      const info = await stat(full);
      found.push({ name: key, size: info.size, updated_at: info.mtime.toISOString() });
    }
  }

  await walk(root);
  return found;
}

export async function read(config: LocalStorage, key: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(safePath(config, key)));
  } catch {
    return null;
  }
}
