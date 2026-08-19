import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { blockedRouteFor } from '@/lib/permissions';
import { OnboardingForm } from './onboarding-form';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const blocked = blockedRouteFor(user.status);
  if (blocked) redirect(blocked);
  if (user.onboarded_at) redirect('/dashboard');

  return <OnboardingForm email={user.email} />;
}
