'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db/client';
import { audit } from '@/lib/audit';
import { assertCanMutate } from '@/lib/permissions';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const formatSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  numFmt: z.enum(['plain', 'number', 'currency', 'percent', 'date']).optional(),
  bg: z.string().max(32).optional(),
  color: z.string().max(32).optional(),
});

const dataSchema = z.object({
  // A cell reference maps to its authored text — a value or a formula.
  cells: z.record(z.string().max(16), z.string().max(10_000)),
  formats: z.record(z.string().max(16), formatSchema),
  rows: z.number().int().min(1).max(2000),
  cols: z.number().int().min(1).max(256),
});

export async function saveSheetAction(
  id: string,
  data: unknown,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = dataSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'That sheet is too large or malformed to save.' };
  }

  const db = asUser(user.id);
  const { data: row, error } = await db
    .from('spreadsheets')
    .update({ data: parsed.data })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  if (!row) return { ok: false, error: 'You do not have edit access to this sheet.' };

  return { ok: true };
}

export async function createSheetAction(
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

  const parsed = z.string().trim().min(1).max(200).safeParse(title || 'Untitled sheet');
  if (!parsed.success) return { ok: false, error: 'Give the sheet a title.' };

  const db = asUser(user.id);
  const { data, error } = await db
    .from('spreadsheets')
    .insert({ title: parsed.data, department_id: departmentId, owner_id: user.id })
    .select('id, title')
    .single();

  if (error || !data) {
    return { ok: false, error: friendly(error?.message ?? 'Could not create that spreadsheet.') };
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'spreadsheet.created',
    targetType: 'spreadsheet',
    targetId: data.id,
    targetLabel: data.title,
  });

  revalidatePath('/spreadsheets');
  return { ok: true, data: { id: data.id } };
}

export async function renameSheetAction(id: string, title: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = z.string().trim().min(1).max(200).safeParse(title);
  if (!parsed.success) return { ok: false, error: 'A sheet needs a title.' };

  const db = asUser(user.id);
  const { data, error } = await db
    .from('spreadsheets')
    .update({ title: parsed.data })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: 'You do not have edit access to this sheet.' };

  revalidatePath(`/spreadsheets/${id}`);
  return { ok: true };
}

export async function deleteSheetAction(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = asUser(user.id);
  const { data, error } = await db
    .from('spreadsheets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, title')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: 'You do not have permission to delete this.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'spreadsheet.deleted',
    targetType: 'spreadsheet',
    targetId: id,
    targetLabel: data.title,
  });

  revalidatePath('/spreadsheets');
  return { ok: true };
}

function friendly(message: string): string {
  if (message.includes('row-level security')) return 'You do not have permission to do that.';
  if (message.includes('frozen') || message.includes('read-only')) {
    return 'That year has been archived and is read-only.';
  }
  return message;
}
