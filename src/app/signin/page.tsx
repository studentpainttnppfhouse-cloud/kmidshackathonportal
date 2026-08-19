import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { schoolDomain } from '@/lib/env';
import { SignInForm } from './signin-form';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // A remembered device skips this screen entirely — that is the whole point
  // of the long-lived session.
  const user = await getSessionUser();
  if (user && user.status === 'active') {
    redirect(user.onboarded_at ? '/dashboard' : '/onboarding');
  }

  const params = await searchParams;
  const next = params.next?.startsWith('/') ? params.next : undefined;

  return <SignInForm next={next} domain={schoolDomain()} />;
}
