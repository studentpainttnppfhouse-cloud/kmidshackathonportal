import 'server-only';
import { adminClient, userClient } from '@/lib/pg/server';

/**
 * File contents.
 *
 * Uploads are held in `file_blobs` — see the migration for why the bytes live
 * in the database rather than in an object store. This module is the only
 * thing that reads or writes them, so if that decision is ever revisited,
 * these few functions are the whole surface to change.
 */

export interface StoredBlob {
  bytes: Buffer;
  mime: string | null;
  name: string;
}

/** Attach contents to a `files` row that has already been created. */
export async function putBlob(fileId: string, bytes: Buffer): Promise<void> {
  const { error } = await adminClient()
    .from('file_blobs')
    .insert({ file_id: fileId, bytes });

  if (error) throw new Error(`Could not store the file: ${error.message}`);
}

/**
 * Fetch a file's contents as the given user.
 *
 * The read runs under their own role, so the same department rules that decide
 * whether they can see the file in the library decide whether they can
 * download it — a link shared outside a department is refused rather than
 * honoured.
 */
export async function getBlob(userId: string, fileId: string): Promise<StoredBlob | null> {
  const db = await userClient(userId);

  const { data } = await db
    .from('files')
    .select('id, name, mime')
    .eq('id', fileId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) return null;

  const { data: blob } = await db
    .from('file_blobs')
    .select('bytes')
    .eq('file_id', fileId)
    .maybeSingle();

  if (!blob?.bytes) return null;

  return {
    bytes: Buffer.isBuffer(blob.bytes) ? blob.bytes : Buffer.from(blob.bytes),
    mime: data.mime ?? null,
    name: data.name ?? 'download',
  };
}

/** Drop the contents of a file whose row was refused or removed for good. */
export async function deleteBlob(fileId: string): Promise<void> {
  await adminClient().from('file_blobs').delete().eq('file_id', fileId);
}

/** Where the browser fetches a stored file from. */
export function downloadPath(fileId: string): string {
  return `/api/files/${fileId}`;
}
