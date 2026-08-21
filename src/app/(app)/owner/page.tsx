import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { adminClient } from '@/lib/pg/server';
import { getDepartments } from '@/lib/db';
import { canManageUsers } from '@/lib/permissions';
import { OwnerConsole } from '@/features/owner/owner-console';
import type { OwnerUser } from '@/features/owner/users-table';
import type { InviteKey, PendingInvite } from '@/features/owner/invites-panel';
import type { AuditRow } from '@/features/owner/audit-viewer';

export const dynamic = 'force-dynamic';

export default async function OwnerPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  // Checked against the real tier — an Owner previewing as T1 still reaches
  // the console, but every action inside it refuses while impersonating.
  if (!canManageUsers(user.tier)) redirect('/dashboard');

  const db = adminClient();

  const [usersRes, invitesRes, keysRes, auditRes, frozenRes, departments] = await Promise.all([
    db
      .from('users')
      .select('id, email, name, nickname, tier, department_id, role_title, status, suspended_until, ban_reason, last_active_at, source_response_id')
      .is('deleted_at', null)
      .order('tier', { ascending: false })
      .order('email'),
    db
      .from('invited_users')
      .select('id, email, tier, department_id, role_title, status, created_at')
      .eq('status', 'pending')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    db
      .from('invite_keys')
      .select('id, code, label, tier, department_id, max_uses, uses, expires_at, revoked_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    db
      .from('audit_log')
      .select('id, actor_email, action, target_type, target_label, diff, ip, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    db.from('archived_years').select('year'),
    getDepartments(user),
  ]);

  const allUsers = (usersRes.data ?? []) as unknown as OwnerUser[];

  return (
    <OwnerConsole
      users={allUsers.filter((u) => u.status !== 'requested')}
      requests={allUsers.filter((u) => u.status === 'requested')}
      invites={(invitesRes.data ?? []) as unknown as PendingInvite[]}
      keys={(keysRes.data ?? []) as unknown as InviteKey[]}
      auditRows={(auditRes.data ?? []) as unknown as AuditRow[]}
      departments={departments}
      currentUserId={user.id}
      frozenYears={((frozenRes.data ?? []) as { year: number }[]).map((r) => r.year)}
    />
  );
}
