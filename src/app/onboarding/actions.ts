'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db/client';
import { audit } from '@/lib/audit';
import { SHIRT_SIZES } from '@/lib/types';

/**
 * Profile setup on first sign-in (§5.1). Minimal personal data only — name,
 * nickname, grade, phone, LINE ID, shirt size (§2.5). Thailand's PDPA applies
 * to these rows, so nothing else is collected here and nothing else should be
 * added later without a reason.
 */
const profileSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  nickname: z.string().trim().min(1, 'Please enter your nickname').max(60),
  grade: z.string().trim().max(30).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  line_id: z.string().trim().max(60).optional().or(z.literal('')),
  shirt_size: z.enum(SHIRT_SIZES).optional().or(z.literal('')),
});

export type ProfileState = { error: string | null };

export async function saveProfileAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const parsed = profileSchema.safeParse({
    name: formData.get('name') ?? '',
    nickname: formData.get('nickname') ?? '',
    grade: formData.get('grade') ?? '',
    phone: formData.get('phone') ?? '',
    line_id: formData.get('line_id') ?? '',
    shirt_size: formData.get('shirt_size') ?? '',
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form.' };
  }

  const v = parsed.data;
  // Goes through the user's own token, so RLS decides whether this is allowed.
  const db = asUser(user.id);
  const { error } = await db
    .from('users')
    .update({
      name: v.name,
      nickname: v.nickname,
      grade: v.grade || null,
      phone: v.phone || null,
      line_id: v.line_id || null,
      shirt_size: v.shirt_size || null,
      onboarded_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) return { error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.profile_updated',
    targetType: 'user',
    targetId: user.id,
    diff: { onboarding: true },
  });

  redirect('/dashboard');
}
