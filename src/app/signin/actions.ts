'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { signInWithEmail } from '@/lib/auth/signin';
import { createDeviceSession, destroyDeviceSession, getSessionUser } from '@/lib/auth/session';
import { audit } from '@/lib/audit';

const signInSchema = z.object({
  email: z.string().trim().min(3).max(254),
  inviteCode: z.string().trim().max(64).optional(),
  next: z.string().startsWith('/').max(512).optional(),
});

export type SignInState = { error: string | null };

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email') ?? '',
    inviteCode: formData.get('inviteCode') ?? undefined,
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { error: 'Enter your school email address.' };
  }

  const outcome = await signInWithEmail(parsed.data.email, parsed.data.inviteCode);

  if (outcome.kind === 'refused') {
    return { error: outcome.reason };
  }

  // A blocked account still gets a device session — otherwise they cannot see
  // which block screen applies to them, and would just bounce to sign-in.
  await createDeviceSession(outcome.user.id);

  if (outcome.kind === 'blocked') {
    redirect(`/blocked/${outcome.status}`);
  }

  // First sign-in goes through profile setup (§5.1).
  if (!outcome.user.onboarded_at) {
    redirect('/onboarding');
  }

  redirect(parsed.data.next ?? '/dashboard');
}

export async function signOutAction(): Promise<void> {
  const user = await getSessionUser();
  if (user) {
    await audit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.signout',
      targetType: 'user',
      targetId: user.id,
    });
  }
  await destroyDeviceSession();
  redirect('/signin');
}
