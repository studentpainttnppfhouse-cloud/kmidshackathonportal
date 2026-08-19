'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/supabase/user';
import { audit } from '@/lib/audit';
import { assertCanMutate } from '@/lib/permissions';
import { CONTENT_STATUSES } from '@/lib/types';

export type ActionResult = { ok: true } | { ok: false; error: string };

const itemSchema = z.object({
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  platform: z.string().trim().min(1, 'Pick a platform').max(60),
  format: z.string().trim().max(60).optional(),
  caption: z.string().trim().max(4000).optional(),
  script: z.string().trim().max(8000).optional(),
  status: z.enum(CONTENT_STATUSES),
  designer_id: z.string().uuid().nullable(),
  editor_id: z.string().uuid().nullable(),
  poster_id: z.string().uuid().nullable(),
  department_id: z.string().uuid().nullable(),
});

export async function saveContentItemAction(
  id: string | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = itemSchema.safeParse({
    scheduled_date: formData.get('scheduled_date') ?? '',
    platform: formData.get('platform') ?? '',
    format: formData.get('format') ?? undefined,
    caption: formData.get('caption') ?? undefined,
    script: formData.get('script') ?? undefined,
    status: formData.get('status') ?? 'idea',
    designer_id: (formData.get('designer_id') as string) || null,
    editor_id: (formData.get('editor_id') as string) || null,
    poster_id: (formData.get('poster_id') as string) || null,
    department_id: (formData.get('department_id') as string) || null,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const db = await userClient(user.id);
  const payload = {
    ...parsed.data,
    format: parsed.data.format || null,
    caption: parsed.data.caption || null,
    script: parsed.data.script || null,
  };

  const { data, error } = id
    ? await db.from('content_items').update(payload).eq('id', id).select('id').maybeSingle()
    : await db.from('content_items').insert(payload).select('id').maybeSingle();

  if (error) {
    return {
      ok: false,
      error: error.message.includes('row-level security')
        ? 'You do not have permission to edit this calendar.'
        : error.message,
    };
  }
  if (!data) return { ok: false, error: 'You do not have permission to edit this calendar.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'assignment.status_changed',
    targetType: 'content_item',
    targetId: data.id,
    targetLabel: `${parsed.data.platform} — ${parsed.data.scheduled_date}`,
    diff: { status: parsed.data.status },
  });

  revalidatePath('/social');
  return { ok: true };
}

export async function deleteContentItemAction(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('content_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'You do not have permission to delete that.' };

  revalidatePath('/social');
  return { ok: true };
}

const accountSchema = z.object({
  platform: z.string().trim().min(1).max(60),
  handle: z.string().trim().min(1).max(120),
  url: z.string().url().optional().or(z.literal('')),
  access_holder_user_id: z.string().uuid().nullable(),
  notes: z.string().trim().max(500).optional(),
});

/** Records WHO holds access. Never a password (§5.11). */
export async function saveSocialAccountAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = accountSchema.safeParse({
    platform: formData.get('platform') ?? '',
    handle: formData.get('handle') ?? '',
    url: formData.get('url') ?? '',
    access_holder_user_id: (formData.get('access_holder_user_id') as string) || null,
    notes: formData.get('notes') ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const id = formData.get('id') as string | null;
  const db = await userClient(user.id);
  const payload = {
    ...parsed.data,
    url: parsed.data.url || null,
    notes: parsed.data.notes || null,
  };

  const { data, error } = id
    ? await db.from('social_accounts').update(payload).eq('id', id).select('id').maybeSingle()
    : await db.from('social_accounts').insert(payload).select('id').maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'You do not have permission to change the accounts panel.' };

  revalidatePath('/social');
  return { ok: true };
}
