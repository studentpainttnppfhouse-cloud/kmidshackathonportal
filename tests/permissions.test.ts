import { describe, expect, it } from 'vitest';
import {
  assertCanMutate, atLeast, blockedRouteFor, canApprove, canCreateAssignment,
  canCreateContent, canEditOwned, canExportAll, canImpersonate, canManageUsers,
  canPublishAnnouncement, canReadDepartment, canReadIncidents, canSeeOwnerConsole,
  canUpdateAssignment, canViewAllAnalytics, canViewAuditLog, canViewSensitivePeopleData,
  canWriteDepartment, isImpersonationReadOnly, isReadOnly, isTier,
} from '@/lib/permissions';
import type { SessionUser, Tier } from '@/lib/types';

const SPONSOR = '11111111-1111-4111-8111-111111111111';
const OPS = '22222222-2222-4222-8222-222222222222';

function user(tier: Tier, over: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    email: 'someone@kmids.ac.th',
    name: null, nickname: null, grade: null, phone: null, line_id: null,
    avatar_url: null, shirt_size: null,
    tier,
    department_id: SPONSOR,
    role_title: null,
    status: 'active',
    is_reserve: false, is_mentor: false, is_alumni: false,
    banned_by: null, banned_at: null, ban_reason: null, suspended_until: null,
    last_active_at: null, source_response_id: null, onboarded_at: '2026-10-01',
    impersonating: null,
    effectiveTier: tier,
    ...over,
  };
}

describe('the tier ladder', () => {
  it('orders tiers cumulatively', () => {
    expect(atLeast('T4', 'T3')).toBe(true);
    expect(atLeast('T3', 'T3')).toBe(true);
    expect(atLeast('T2', 'T3')).toBe(false);
    expect(atLeast('T0', 'T1')).toBe(false);
  });

  it('recognises valid tier strings', () => {
    expect(isTier('T2')).toBe(true);
    expect(isTier('T5')).toBe(false);
    expect(isTier('admin')).toBe(false);
  });
});

describe('T0 Advisor is read-only', () => {
  const advisor = user('T0', { department_id: null });

  it('reads across every department', () => {
    expect(canReadDepartment(advisor, SPONSOR)).toBe(true);
    expect(canReadDepartment(advisor, OPS)).toBe(true);
  });

  it('cannot write anywhere', () => {
    expect(isReadOnly('T0')).toBe(true);
    expect(canWriteDepartment(advisor, SPONSOR)).toBe(false);
    expect(canCreateContent(advisor, SPONSOR)).toBe(false);
    expect(canCreateContent(advisor, null)).toBe(false);
    expect(canApprove(advisor, SPONSOR)).toBe(false);
  });

  it('cannot edit even something it owns', () => {
    expect(canEditOwned(advisor, { owner_id: advisor.id, department_id: SPONSOR })).toBe(false);
  });

  it('is withheld from interview and performance data', () => {
    expect(canViewSensitivePeopleData('T0')).toBe(false);
  });

  it('is refused by the mutation gate', () => {
    expect(() => assertCanMutate(advisor)).toThrow(/read-only/i);
  });
});

describe('T1 Member', () => {
  const member = user('T1');

  it('reads its own department and the General space, not others', () => {
    expect(canReadDepartment(member, SPONSOR)).toBe(true);
    expect(canReadDepartment(member, null)).toBe(true);
    expect(canReadDepartment(member, OPS)).toBe(false);
  });

  it('creates its own content but cannot write department-wide', () => {
    expect(canCreateContent(member, SPONSOR)).toBe(true);
    expect(canCreateContent(member, null)).toBe(true);
    expect(canCreateContent(member, OPS)).toBe(false);
    expect(canWriteDepartment(member, SPONSOR)).toBe(false);
    expect(canCreateAssignment(member, SPONSOR)).toBe(false);
  });

  it('advances a task it is assigned to, but cannot approve it', () => {
    const assignment = { department_id: SPONSOR, assignee_ids: [member.id] };
    expect(canUpdateAssignment(member, assignment)).toBe(true);
    expect(canApprove(member, SPONSOR)).toBe(false);
  });

  it('cannot touch a task it is not assigned to', () => {
    expect(
      canUpdateAssignment(member, { department_id: SPONSOR, assignee_ids: ['someone-else'] }),
    ).toBe(false);
  });

  it('edits what it owns', () => {
    expect(canEditOwned(member, { owner_id: member.id, department_id: SPONSOR })).toBe(true);
    expect(canEditOwned(member, { owner_id: 'other', department_id: SPONSOR })).toBe(false);
  });
});

describe('T2 Department Head', () => {
  const head = user('T2');

  it('has full write inside its own department only', () => {
    expect(canWriteDepartment(head, SPONSOR)).toBe(true);
    expect(canWriteDepartment(head, OPS)).toBe(false);
  });

  it('reads other departments but cannot write to them', () => {
    expect(canReadDepartment(head, OPS)).toBe(false);
    expect(canCreateAssignment(head, OPS)).toBe(false);
  });

  it('approves within its department only', () => {
    expect(canApprove(head, SPONSOR)).toBe(true);
    expect(canApprove(head, OPS)).toBe(false);
  });

  it('edits anything in its department, regardless of owner', () => {
    expect(canEditOwned(head, { owner_id: 'someone-else', department_id: SPONSOR })).toBe(true);
    expect(canEditOwned(head, { owner_id: 'someone-else', department_id: OPS })).toBe(false);
  });

  it('announces to its department but not to all staff', () => {
    expect(canPublishAnnouncement(head, 'department', SPONSOR)).toBe(true);
    expect(canPublishAnnouncement(head, 'all', null)).toBe(false);
  });

  it('cannot reach the Owner Console or the audit log', () => {
    expect(canManageUsers('T2')).toBe(false);
    expect(canViewAuditLog('T2')).toBe(false);
    expect(canSeeOwnerConsole('T2')).toBe(false);
  });

  it('cannot read the incident log', () => {
    expect(canReadIncidents('T2')).toBe(false);
  });
});

describe('T3 Administration', () => {
  const admin = user('T3', { department_id: null });

  it('reads and writes across every department', () => {
    expect(canReadDepartment(admin, SPONSOR)).toBe(true);
    expect(canReadDepartment(admin, OPS)).toBe(true);
    expect(canWriteDepartment(admin, OPS)).toBe(true);
    expect(canApprove(admin, OPS)).toBe(true);
  });

  it('publishes all-staff announcements', () => {
    expect(canPublishAnnouncement(admin, 'all', null)).toBe(true);
  });

  it('sees all analytics and the incident log', () => {
    expect(canViewAllAnalytics('T3')).toBe(true);
    expect(canReadIncidents('T3')).toBe(true);
  });

  it('CANNOT manage users, read the audit log, export, or impersonate', () => {
    // This is the line between T3 and T4 and the most likely thing to drift.
    expect(canManageUsers('T3')).toBe(false);
    expect(canViewAuditLog('T3')).toBe(false);
    expect(canExportAll('T3')).toBe(false);
    expect(canImpersonate('T3')).toBe(false);
  });
});

describe('T4 Owner', () => {
  it('has everything T3 has, plus the console', () => {
    expect(canManageUsers('T4')).toBe(true);
    expect(canViewAuditLog('T4')).toBe(true);
    expect(canExportAll('T4')).toBe(true);
    expect(canImpersonate('T4')).toBe(true);
    expect(canSeeOwnerConsole('T4')).toBe(true);
    expect(canViewAllAnalytics('T4')).toBe(true);
  });
});

describe('the General space', () => {
  it('is readable by every tier', () => {
    for (const tier of ['T0', 'T1', 'T2', 'T3', 'T4'] as Tier[]) {
      expect(canReadDepartment(user(tier), null)).toBe(true);
    }
  });

  it('accepts content from every tier except Advisors', () => {
    expect(canCreateContent(user('T1'), null)).toBe(true);
    expect(canCreateContent(user('T0'), null)).toBe(false);
  });
});

describe('account status gating', () => {
  it('routes each blocked status to its own screen', () => {
    expect(blockedRouteFor('active')).toBeNull();
    expect(blockedRouteFor('requested')).toBe('/blocked/requested');
    expect(blockedRouteFor('pending')).toBe('/blocked/pending');
    expect(blockedRouteFor('suspended')).toBe('/blocked/suspended');
    expect(blockedRouteFor('banned')).toBe('/blocked/banned');
  });

  it('refuses mutations from a non-active account', () => {
    for (const status of ['requested', 'pending', 'suspended', 'banned'] as const) {
      expect(() => assertCanMutate(user('T2', { status }))).toThrow(/not active/i);
    }
  });
});

describe('impersonation is read-only', () => {
  const owner = user('T4', { impersonating: 'T1', effectiveTier: 'T1' });

  it('is recognised as read-only', () => {
    expect(isImpersonationReadOnly(owner)).toBe(true);
    expect(isImpersonationReadOnly(user('T4'))).toBe(false);
  });

  it('blocks every mutation while previewing', () => {
    expect(() => assertCanMutate(owner)).toThrow(/read-only/i);
  });

  it('applies the previewed tier to reads, not the real one', () => {
    // An Owner viewing as T1 must not still see other departments, or the
    // preview would be useless for verifying the permission model.
    expect(canReadDepartment(owner, OPS)).toBe(false);
    expect(canWriteDepartment(owner, OPS)).toBe(false);
  });

  it('still recognises the real tier for console access', () => {
    // Checked against `tier`, not `effectiveTier` — otherwise an Owner
    // previewing as T1 could never switch back.
    expect(canManageUsers(owner.tier)).toBe(true);
    expect(canImpersonate(owner.tier)).toBe(true);
  });
});

describe('a member with no department', () => {
  const orphan = user('T1', { department_id: null });

  it('reaches the General space only', () => {
    expect(canReadDepartment(orphan, null)).toBe(true);
    expect(canReadDepartment(orphan, SPONSOR)).toBe(false);
  });

  it('is not accidentally granted department-wide write by a null match', () => {
    // canWriteDepartment for T2 compares department_id === departmentId; a
    // null-to-null match must not become a licence over the General space.
    const orphanHead = user('T2', { department_id: null });
    expect(canWriteDepartment(orphanHead, SPONSOR)).toBe(false);
  });
});
