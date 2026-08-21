'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser, revokeAllSessions } from '@/lib/auth/session';
import { adminClient, userClient } from '@/lib/pg/server';
import { audit } from '@/lib/audit';
import { SHIRT_SIZES } from '@/lib/types';

export type ActionResult = { ok: true } | { ok: false; error: string };

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  nickname: z.string().trim().min(1, 'Nickname is required').max(60),
  grade: z.string().trim().max(30).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  line_id: z.string().trim().max(60).optional().or(z.literal('')),
  shirt_size: z.enum(SHIRT_SIZES).optional().or(z.literal('')),
});

export async function updateProfileAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  if (user.impersonating) return { ok: false, error: 'Impersonation sessions are read-only' };

  const parsed = profileSchema.safeParse({
    name: formData.get('name') ?? '',
    nickname: formData.get('nickname') ?? '',
    grade: formData.get('grade') ?? '',
    phone: formData.get('phone') ?? '',
    line_id: formData.get('line_id') ?? '',
    shirt_size: formData.get('shirt_size') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const v = parsed.data;
  const db = await userClient(user.id);
  const { error } = await db
    .from('users')
    .update({
      name: v.name,
      nickname: v.nickname,
      grade: v.grade || null,
      phone: v.phone || null,
      line_id: v.line_id || null,
      shirt_size: v.shirt_size || null,
    })
    .eq('id', user.id);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.profile_updated',
    targetType: 'user',
    targetId: user.id,
  });

  revalidatePath('/settings');
  return { ok: true };
}

/** Sign out every other device. Useful on a shared or lost phone. */
export async function signOutEverywhereAction(): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  await revokeAllSessions(user.id);
  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.signout',
    targetType: 'user',
    targetId: user.id,
    diff: { scope: 'all devices' },
  });

  return { ok: true };
}

export async function revokeDeviceAction(sessionId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = z.string().uuid().safeParse(sessionId);
  if (!parsed.success) return { ok: false, error: 'Unknown device' };

  // Scoped to this user's own sessions, so nobody can revoke someone else's.
  const { error } = await adminClient()
    .from('device_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/settings');
  return { ok: true };
}
