import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser, hashToken, SESSION_COOKIE } from '@/lib/auth/session';
import { admin } from '@/lib/db/client';
import { getDepartments } from '@/lib/db/reads';
import { SettingsClient, type DeviceRow } from '@/features/settings/settings-client';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const jar = await cookies();
  const currentHash = jar.get(SESSION_COOKIE)?.value
    ? hashToken(jar.get(SESSION_COOKIE)!.value)
    : null;

  const [departments, sessionsRes] = await Promise.all([
    getDepartments(user),
    admin()
      .from('device_sessions')
      .select('id, device_label, user_agent, created_at, last_seen_at, token_hash')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .order('last_seen_at', { ascending: false }),
  ]);

  const devices: DeviceRow[] = (
    (sessionsRes.data ?? []) as unknown as (Omit<DeviceRow, 'isCurrent'> & { token_hash: string })[]
  ).map((d) => ({
    id: d.id,
    device_label: d.device_label,
    user_agent: d.user_agent,
    created_at: d.created_at,
    last_seen_at: d.last_seen_at,
    isCurrent: d.token_hash === currentHash,
  }));

  const department = departments.find((d) => d.id === user.department_id);

  return (
    <SettingsClient
      user={user}
      departmentName={department?.name ?? 'No department'}
      devices={devices}
    />
  );
}
