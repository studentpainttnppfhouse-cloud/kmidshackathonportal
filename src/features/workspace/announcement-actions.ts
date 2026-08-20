'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db/client';
import { audit } from '@/lib/audit';
import { assertCanMutate, canPublishAnnouncement } from '@/lib/permissions';

const schema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(200),
  body: z.string().trim().min(1, 'Write the announcement').max(4000),
  scope: z.enum(['all', 'department']),
  department_id: z.string().uuid().nullable(),
  pinned: z.boolean().default(false),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function publishAnnouncementAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = schema.safeParse({
    title: formData.get('title') ?? '',
    body: formData.get('body') ?? '',
    scope: (formData.get('scope') as string) || 'department',
    department_id: (formData.get('department_id') as string) || null,
    pinned: formData.get('pinned') === 'on',
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const v = parsed.data;
  // All-staff announcements are T3+; the database enforces this too.
  if (!canPublishAnnouncement(user, v.scope, v.department_id)) {
    return {
      ok: false,
      error:
        v.scope === 'all'
          ? 'Only Administration can post to all staff.'
          : 'You cannot post to that department.',
    };
  }

  const db = asUser(user.id);
  const { data, error } = await db
    .from('announcements')
    .insert({
      title: v.title,
      body: v.body,
      scope: v.scope,
      department_id: v.scope === 'all' ? null : v.department_id,
      author_id: user.id,
      pinned: v.pinned,
    })
    .select('id, title')
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message.includes('row-level security')
        ? 'You do not have permission to post that.'
        : error?.message ?? 'Could not post that announcement.',
    };
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'announcement.published',
    targetType: 'announcement',
    targetId: data.id,
    targetLabel: data.title,
    diff: { scope: v.scope, department: v.department_id, pinned: v.pinned },
  });

  revalidatePath('/workspace');
  revalidatePath('/dashboard');
  return { ok: true };
}

/** Read receipts (§5.10) — writes your own row, nobody else's. */
export async function markAnnouncementReadAction(id: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const db = asUser(user.id);
  await db
    .from('announcement_reads')
    .upsert({ announcement_id: id, user_id: user.id }, { onConflict: 'announcement_id,user_id' });
}
