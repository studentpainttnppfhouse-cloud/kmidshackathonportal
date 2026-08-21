/**
 * Tier logic, mirrored from the policies written alongside each table in
 * db/migrations/.
 *
 * Nothing here is a security boundary — the database is. These helpers exist
 * so the UI does not offer buttons that the database is going to reject.
 * Every function has a matching SQL policy; if you change one, change both.
 */
import { TIERS, type AccountStatus, type SessionUser, type Tier } from './types';

/** Numeric rank so tiers can be compared. T0 is deliberately outside the ladder. */
const RANK: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 };

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

/** True when `tier` sits at or above `min` on the ladder. */
export function atLeast(tier: Tier, min: Tier): boolean {
  return RANK[tier] >= RANK[min];
}

/**
 * T0 Advisor is read-only across the whole app: it can read broadly but is
 * never allowed to create, edit or delete anything except comments.
 */
export function isReadOnly(tier: Tier): boolean {
  return tier === 'T0';
}

export function canComment(tier: Tier): boolean {
  return true;
}

/** Reading department content: own department, or T3+ anywhere, or T0 anywhere. */
export function canReadDepartment(
  user: Pick<SessionUser, 'effectiveTier' | 'department_id'>,
  departmentId: string | null,
): boolean {
  // The General space (null department) is visible to every signed-in user.
  if (departmentId === null) return true;
  if (user.effectiveTier === 'T0') return true;
  if (atLeast(user.effectiveTier, 'T3')) return true;
  return user.department_id === departmentId;
}

/** Writing department content: T2 in own department, or T3+ anywhere. */
export function canWriteDepartment(
  user: Pick<SessionUser, 'effectiveTier' | 'department_id'>,
  departmentId: string | null,
): boolean {
  if (isReadOnly(user.effectiveTier)) return false;
  if (atLeast(user.effectiveTier, 'T3')) return true;
  if (user.effectiveTier === 'T2') return user.department_id === departmentId;
  return false;
}

/**
 * T1 Members may create their own documents, spreadsheets and files inside
 * their own department or the General space.
 */
export function canCreateContent(
  user: Pick<SessionUser, 'effectiveTier' | 'department_id'>,
  departmentId: string | null,
): boolean {
  if (isReadOnly(user.effectiveTier)) return false;
  if (atLeast(user.effectiveTier, 'T3')) return true;
  if (departmentId === null) return atLeast(user.effectiveTier, 'T1');
  return user.department_id === departmentId && atLeast(user.effectiveTier, 'T1');
}

/** Editing an individual item: owner, department head, or T3+. */
export function canEditOwned(
  user: Pick<SessionUser, 'id' | 'effectiveTier' | 'department_id'>,
  item: { owner_id: string | null; department_id: string | null },
): boolean {
  if (isReadOnly(user.effectiveTier)) return false;
  if (atLeast(user.effectiveTier, 'T3')) return true;
  if (item.owner_id === user.id) return true;
  if (user.effectiveTier === 'T2') return user.department_id === item.department_id;
  return false;
}

/** Only T2+ may move an assignment into Approved. */
export function canApprove(
  user: Pick<SessionUser, 'effectiveTier' | 'department_id'>,
  departmentId: string | null,
): boolean {
  if (isReadOnly(user.effectiveTier)) return false;
  if (atLeast(user.effectiveTier, 'T3')) return true;
  return user.effectiveTier === 'T2' && user.department_id === departmentId;
}

/** Assignees may move their own task along, short of Approved. */
export function canUpdateAssignment(
  user: Pick<SessionUser, 'id' | 'effectiveTier' | 'department_id'>,
  assignment: { department_id: string | null; assignee_ids: readonly string[] },
): boolean {
  if (isReadOnly(user.effectiveTier)) return false;
  if (atLeast(user.effectiveTier, 'T3')) return true;
  if (user.effectiveTier === 'T2' && user.department_id === assignment.department_id) {
    return true;
  }
  return assignment.assignee_ids.includes(user.id);
}

/** Creating and assigning assignments is a T2+ act. */
export function canCreateAssignment(
  user: Pick<SessionUser, 'effectiveTier' | 'department_id'>,
  departmentId: string | null,
): boolean {
  return canWriteDepartment(user, departmentId);
}

/** All-staff announcements are T3+; department announcements are T2+. */
export function canPublishAnnouncement(
  user: Pick<SessionUser, 'effectiveTier' | 'department_id'>,
  scope: 'all' | 'department',
  departmentId: string | null,
): boolean {
  if (isReadOnly(user.effectiveTier)) return false;
  if (scope === 'all') return atLeast(user.effectiveTier, 'T3');
  return canWriteDepartment(user, departmentId);
}

/** The Owner Console, in full. */
export function canManageUsers(tier: Tier): boolean {
  return tier === 'T4';
}

/** The audit log is Owner-only, and read-only even for them. */
export function canViewAuditLog(tier: Tier): boolean {
  return tier === 'T4';
}

export function canExportAll(tier: Tier): boolean {
  return tier === 'T4';
}

export function canImpersonate(tier: Tier): boolean {
  return tier === 'T4';
}

export function canFreezeArchive(tier: Tier): boolean {
  return tier === 'T4';
}

/** Analytics across all departments. */
export function canViewAllAnalytics(tier: Tier): boolean {
  return atLeast(tier, 'T3');
}

/**
 * Interview and performance data is withheld from Advisors specifically,
 * per the T0 scope in §3.
 */
export function canViewSensitivePeopleData(tier: Tier): boolean {
  return tier !== 'T0' && atLeast(tier, 'T2');
}

/** Incidents may be filed by anyone on staff but read only by T3+. */
export function canReadIncidents(tier: Tier): boolean {
  return atLeast(tier, 'T3');
}

export function canFileIncident(status: AccountStatus): boolean {
  return status === 'active';
}

/** Which account statuses may use the app at all. */
export function canAccessApp(status: AccountStatus): boolean {
  return status === 'active';
}

/** Where middleware should send a user who cannot access the app. */
export function blockedRouteFor(status: AccountStatus): string | null {
  switch (status) {
    case 'active':
      return null;
    case 'requested':
      return '/blocked/requested';
    case 'pending':
      return '/blocked/pending';
    case 'suspended':
      return '/blocked/suspended';
    case 'banned':
      return '/blocked/banned';
  }
}

/**
 * An Owner previewing a lower tier must not be able to change anything —
 * impersonation sessions are read-only by design.
 */
export function isImpersonationReadOnly(user: Pick<SessionUser, 'impersonating'>): boolean {
  return user.impersonating !== null;
}

/** The single gate every mutating Server Action calls first. */
export function assertCanMutate(user: SessionUser): void {
  if (!canAccessApp(user.status)) {
    throw new Error('Account is not active');
  }
  if (isImpersonationReadOnly(user)) {
    throw new Error('Impersonation sessions are read-only');
  }
  if (isReadOnly(user.effectiveTier)) {
    throw new Error('Advisors have read-only access');
  }
}

/** Nav items a tier is allowed to see. Mirrors the sidebar in the design. */
export function canSeeOwnerConsole(tier: Tier): boolean {
  return tier === 'T4';
}
