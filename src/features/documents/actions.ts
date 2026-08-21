'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { audit } from '@/lib/audit';
import { assertCanMutate } from '@/lib/permissions';
import { DOC_STATUSES } from '@/lib/types';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const createSchema = z.object({
  title: z.string().trim().min(1).max(200).default('Untitled'),
  department_id: z.string().uuid().nullable(),
});

export async function createDocumentAction(
  title: string,
  departmentId: string | null,
): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = createSchema.safeParse({ title, department_id: departmentId });
  if (!parsed.success) return { ok: false, error: 'Give the document a title.' };

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('documents')
    .insert({
      title: parsed.data.title,
      department_id: parsed.data.department_id,
      owner_id: user.id,
    })
    .select('id, title')
    .single();

  if (error) return { ok: false, error: friendly(error.message) };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'document.created',
    targetType: 'document',
    targetId: data.id,
    targetLabel: data.title,
  });

  revalidatePath('/documents');
  return { ok: true, data: { id: data.id } };
}

const saveSchema = z.object({
  id: z.string().uuid(),
  content: z.unknown(),
  plainText: z.string().max(500_000),
  title: z.string().trim().min(1).max(200),
});

/**
 * Autosave. Called on a debounce from the editor, so it stays deliberately
 * cheap: no version row, no audit entry per keystroke.
 */
export async function saveDocumentAction(
  id: string,
  content: unknown,
  plainText: string,
  title: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = saveSchema.safeParse({ id, content, plainText, title });
  if (!parsed.success) return { ok: false, error: 'Could not save — invalid content.' };

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('documents')
    .update({
      content: parsed.data.content as Record<string, unknown>,
      plain_text: parsed.data.plainText,
      title: parsed.data.title,
    })
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: 'You do not have edit access to this document.' };

  return { ok: true };
}

/** Named snapshot for the version history (§5.6). */
export async function snapshotDocumentAction(
  id: string,
  label: string | null,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = await userClient(user.id);
  const { data: doc } = await db
    .from('documents')
    .select('id, content, plain_text, title')
    .eq('id', id)
    .maybeSingle();

  if (!doc) return { ok: false, error: 'Document not found.' };

  const { error } = await db.from('document_versions').insert({
    document_id: id,
    content: doc.content,
    plain_text: doc.plain_text,
    label: label?.trim() || null,
    created_by: user.id,
  });

  if (error) return { ok: false, error: friendly(error.message) };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'document.edited',
    targetType: 'document',
    targetId: id,
    targetLabel: doc.title,
    diff: { snapshot: label ?? 'unnamed' },
  });

  revalidatePath(`/documents/${id}`);
  return { ok: true };
}

/**
 * Restore writes the old content forward as a new save rather than rewinding
 * history, so the restore itself is undoable.
 */
export async function restoreVersionAction(
  documentId: string,
  versionId: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = await userClient(user.id);
  const { data: version } = await db
    .from('document_versions')
    .select('content, plain_text')
    .eq('id', versionId)
    .eq('document_id', documentId)
    .maybeSingle();

  if (!version) return { ok: false, error: 'That version no longer exists.' };

  // Snapshot what is there now, so restoring is never destructive.
  await snapshotDocumentAction(documentId, 'Before restore');

  const { data, error } = await db
    .from('documents')
    .update({ content: version.content, plain_text: version.plain_text })
    .eq('id', documentId)
    .select('id, title')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: 'You do not have edit access to this document.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'document.restored',
    targetType: 'document',
    targetId: documentId,
    targetLabel: data.title,
    diff: { restored_version: versionId },
  });

  revalidatePath(`/documents/${documentId}`);
  return { ok: true };
}

export async function setDocumentStatusAction(
  id: string,
  status: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = z.enum(DOC_STATUSES).safeParse(status);
  if (!parsed.success) return { ok: false, error: 'Unknown status' };

  const db = await userClient(user.id);
  const patch: Record<string, unknown> = { status: parsed.data };
  if (parsed.data === 'approved') {
    patch.approved_by = user.id;
    patch.approved_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from('documents')
    .update(patch)
    .eq('id', id)
    .select('id, title')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: 'You do not have permission to change this.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'document.edited',
    targetType: 'document',
    targetId: id,
    targetLabel: data.title,
    diff: { status: parsed.data },
  });

  revalidatePath(`/documents/${id}`);
  return { ok: true };
}

export async function deleteDocumentAction(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, title')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: 'You do not have permission to delete this.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'document.deleted',
    targetType: 'document',
    targetId: id,
    targetLabel: data.title,
  });

  revalidatePath('/documents');
  return { ok: true };
}

function friendly(message: string): string {
  if (message.includes('row-level security')) return 'You do not have permission to do that.';
  if (message.includes('frozen') || message.includes('read-only')) {
    return 'That year has been archived and is read-only.';
  }
  return message;
}
