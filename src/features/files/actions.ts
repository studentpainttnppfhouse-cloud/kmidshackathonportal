'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/supabase/user';
import { adminClient } from '@/lib/supabase/admin';
import { audit } from '@/lib/audit';
import { assertCanMutate } from '@/lib/permissions';
import { MAX_FILE_BYTES, STORAGE_BUCKET } from './constants';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(255),
  department_id: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().max(40)).max(12),
  is_brand_asset: z.boolean(),
});

export async function uploadFileAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a file first.' };
  }

  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `That file is ${(file.size / 1048576).toFixed(1)} MB. The cap is 50 MB — add it as an external link instead.`,
    };
  }

  const parsed = uploadSchema.safeParse({
    name: (formData.get('name') as string) || file.name,
    department_id: (formData.get('department_id') as string) || null,
    tags: String(formData.get('tags') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    is_brand_asset: formData.get('is_brand_asset') === 'on',
  });

  if (!parsed.success) return { ok: false, error: 'Check the upload form.' };

  const v = parsed.data;
  const key = `${v.department_id ?? 'general'}/${crypto.randomUUID()}-${sanitise(file.name)}`;

  // Storage upload uses the service role; the row insert below goes through
  // the user's token, so RLS still decides whether they may file it here.
  const upload = await adminClient()
    .storage.from(STORAGE_BUCKET)
    .upload(key, file, { contentType: file.type || 'application/octet-stream', upsert: false });

  if (upload.error) {
    return { ok: false, error: `Upload failed: ${upload.error.message}` };
  }

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('files')
    .insert({
      name: v.name,
      storage_path: key,
      mime: file.type || null,
      size: file.size,
      department_id: v.department_id,
      uploaded_by: user.id,
      tags: v.tags,
      is_brand_asset: v.is_brand_asset,
    })
    .select('id, name')
    .maybeSingle();

  if (error || !data) {
    // Do not leave an orphaned object behind if the row was refused.
    await adminClient().storage.from(STORAGE_BUCKET).remove([key]);
    return {
      ok: false,
      error: error?.message.includes('row-level security')
        ? 'You do not have permission to upload to that department.'
        : error?.message ?? 'Upload was rejected.',
    };
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'file.uploaded',
    targetType: 'file',
    targetId: data.id,
    targetLabel: data.name,
    diff: { size: file.size, mime: file.type, department: v.department_id },
  });

  revalidatePath('/files');
  return { ok: true };
}

const linkSchema = z.object({
  name: z.string().trim().min(1).max(255),
  external_url: z.string().url('That does not look like a URL'),
  department_id: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().max(40)).max(12),
});

/** Larger media lives elsewhere and is referenced by link (§5.9). */
export async function addExternalLinkAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = linkSchema.safeParse({
    name: formData.get('name') ?? '',
    external_url: formData.get('external_url') ?? '',
    department_id: (formData.get('department_id') as string) || null,
    tags: String(formData.get('tags') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('files')
    .insert({ ...parsed.data, uploaded_by: user.id })
    .select('id, name')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'That link was rejected.' };
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'file.uploaded',
    targetType: 'file',
    targetId: data.id,
    targetLabel: data.name,
    diff: { external: true },
  });

  revalidatePath('/files');
  return { ok: true };
}

export async function deleteFileAction(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = await userClient(user.id);
  // Soft delete only — the object stays in storage so a mistaken delete is
  // recoverable from the recycle bin.
  const { data, error } = await db
    .from('files')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, name')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'You do not have permission to delete that file.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'file.deleted',
    targetType: 'file',
    targetId: id,
    targetLabel: data.name,
  });

  revalidatePath('/files');
  return { ok: true };
}

function sanitise(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 100);
}
