import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { blockedRouteFor } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';

/**
 * Every app route renders through here, so this is where account status is
 * checked on each request (§5.1). Middleware only knows whether a cookie
 * exists; this is the layer that knows whether the account behind it is
 * still allowed in.
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const blocked = blockedRouteFor(user.status);
  if (blocked) redirect(blocked);

  if (!user.onboarded_at) redirect('/onboarding');

  return <AppShell user={user}>{children}</AppShell>;
}
