import 'server-only';
import { adminClient } from '@/lib/pg/server';
import { audit } from '@/lib/audit';
import { ownerEmails, schoolDomain } from '@/lib/env';
import type { AccountStatus, AppUser, Tier } from '@/lib/types';

/**
 * Email-only sign-in.
 *
 * There is no password and no OAuth: you type your school address and you are
 * in. That is a deliberate trade for an internal, invite-only staff portal
 * where the cost of a forgotten password on event morning is higher than the
 * cost of someone typing a colleague's address. It does mean anyone who knows
 * a staff email can sign in as them, so the tier system — not the login — is
 * what actually protects anything, and every action is attributed in the
 * audit log.
 *
 * Four ways in, exactly as §4 lays out:
 *   Owner bootstrap  — OWNER_EMAIL / OWNER_BACKUP_EMAIL become T4 on sight
 *   A. direct invite — a pending row in invited_users carries tier + department
 *   B. invite key    — a shared code carries tier + department
 *   C. access request — a school address with no invite lands in the queue
 * Anything else is refused outright.
 */

export type SignInOutcome =
  | { kind: 'signed_in'; user: AppUser }
  | { kind: 'blocked'; user: AppUser; status: AccountStatus }
  | { kind: 'refused'; reason: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isSchoolEmail(email: string): boolean {
  return email.endsWith(`@${schoolDomain()}`);
}

export async function signInWithEmail(
  rawEmail: string,
  inviteCode?: string,
): Promise<SignInOutcome> {
  const email = normalizeEmail(rawEmail);

  if (!EMAIL_RE.test(email)) {
    return { kind: 'refused', reason: 'That does not look like an email address.' };
  }

  const db = adminClient();

  // Returning user — the common path.
  const { data: existing } = await db
    .from('users')
    .select('*')
    .eq('email', email)
    .is('deleted_at', null)
    .maybeSingle<AppUser>();

  if (existing) {
    // An Owner listed in the environment is repaired back to T4 on sign-in,
    // so losing Owner access can always be fixed by editing an env var.
    if (ownerEmails().includes(email) && existing.tier !== 'T4') {
      const { data: promoted } = await db
        .from('users')
        .update({ tier: 'T4', status: 'active' })
        .eq('id', existing.id)
        .select('*')
        .maybeSingle<AppUser>();
      if (promoted) {
        await audit({
          actorId: promoted.id,
          actorEmail: email,
          action: 'user.tier_changed',
          targetType: 'user',
          targetId: promoted.id,
          diff: { tier: { from: existing.tier, to: 'T4' }, via: 'OWNER_EMAIL bootstrap' },
        });
        return finish(promoted, email);
      }
    }

    // A pending invite that arrived after they first requested access is
    // applied now, which upgrades a `requested` account in place.
    const applied = await applyPendingInvite(existing, email);
    return finish(applied, email);
  }

  // New account.
  if (ownerEmails().includes(email)) {
    const created = await createUser({ email, tier: 'T4', status: 'active' });
    await audit({
      actorId: created.id,
      actorEmail: email,
      action: 'auth.account_created',
      targetType: 'user',
      targetId: created.id,
      diff: { path: 'owner bootstrap', tier: 'T4' },
    });
    return finish(created, email);
  }

  // Path A — a direct invite is waiting.
  const invite = await findPendingInvite(email);
  if (invite) {
    const created = await createUser({
      email,
      tier: invite.tier,
      status: 'active',
      departmentId: invite.department_id,
      roleTitle: invite.role_title,
    });
    await db
      .from('invited_users')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invite.id);
    await audit({
      actorId: created.id,
      actorEmail: email,
      action: 'auth.account_created',
      targetType: 'user',
      targetId: created.id,
      diff: { path: 'direct invite', tier: invite.tier, department: invite.department_id },
    });
    return finish(created, email);
  }

  // Path B — an invite key was pasted.
  if (inviteCode?.trim()) {
    const key = await redeemInviteKey(inviteCode.trim());
    if (key === 'invalid') {
      return { kind: 'refused', reason: 'That invite key is not valid, or it has expired.' };
    }
    const created = await createUser({
      email,
      tier: key.tier,
      status: 'active',
      departmentId: key.department_id,
      roleTitle: key.role_title,
    });
    await audit({
      actorId: created.id,
      actorEmail: email,
      action: 'invite_key.used',
      targetType: 'invite_key',
      targetId: key.id,
      targetLabel: key.code,
      diff: { tier: key.tier, department: key.department_id },
    });
    return finish(created, email);
  }

  // Path C — a school address with no invite joins the pending queue.
  if (isSchoolEmail(email)) {
    const created = await createUser({ email, tier: 'T1', status: 'requested' });
    await audit({
      actorId: created.id,
      actorEmail: email,
      action: 'auth.access_requested',
      targetType: 'user',
      targetId: created.id,
    });
    return { kind: 'blocked', user: created, status: 'requested' };
  }

  // Everyone else is refused, and the attempt is recorded.
  await audit({
    actorEmail: email,
    action: 'auth.denied',
    targetType: 'email',
    targetLabel: email,
    diff: { reason: 'not a school address and not invited' },
  });
  return {
    kind: 'refused',
    reason: `Use your @${schoolDomain()} school address, or ask the event Owner for an invite.`,
  };
}

async function finish(user: AppUser, email: string): Promise<SignInOutcome> {
  if (user.status !== 'active') {
    return { kind: 'blocked', user, status: user.status };
  }
  await audit({
    actorId: user.id,
    actorEmail: email,
    action: 'auth.signin',
    targetType: 'user',
    targetId: user.id,
  });
  return { kind: 'signed_in', user };
}

interface CreateUserInput {
  email: string;
  tier: Tier;
  status: AccountStatus;
  departmentId?: string | null;
  roleTitle?: string | null;
}

async function createUser(input: CreateUserInput): Promise<AppUser> {
  const { data, error } = await adminClient()
    .from('users')
    .insert({
      email: input.email,
      tier: input.tier,
      status: input.status,
      department_id: input.departmentId ?? null,
      role_title: input.roleTitle ?? null,
    })
    .select('*')
    .single<AppUser>();

  if (error) throw new Error(`Could not create account: ${error.message}`);
  return data;
}

interface PendingInvite {
  id: string;
  tier: Tier;
  department_id: string | null;
  role_title: string | null;
}

async function findPendingInvite(email: string): Promise<PendingInvite | null> {
  const { data } = await adminClient()
    .from('invited_users')
    .select('id, tier, department_id, role_title, expires_at')
    .eq('email', email)
    .eq('status', 'pending')
    .is('deleted_at', null)
    .maybeSingle<PendingInvite & { expires_at: string | null }>();

  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return data;
}

/** Applies an invite that landed while the account was sitting in the queue. */
async function applyPendingInvite(user: AppUser, email: string): Promise<AppUser> {
  if (user.status !== 'requested' && user.status !== 'pending') return user;

  const invite = await findPendingInvite(email);
  if (!invite) return user;

  const db = adminClient();
  const { data } = await db
    .from('users')
    .update({
      tier: invite.tier,
      status: 'active',
      department_id: invite.department_id,
      role_title: invite.role_title,
    })
    .eq('id', user.id)
    .select('*')
    .maybeSingle<AppUser>();

  await db
    .from('invited_users')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return data ?? user;
}

interface InviteKeyRow {
  id: string;
  code: string;
  tier: Tier;
  department_id: string | null;
  role_title: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
}

async function redeemInviteKey(code: string): Promise<InviteKeyRow | 'invalid'> {
  const db = adminClient();
  const { data } = await db
    .from('invite_keys')
    .select('*')
    .eq('code', code.toUpperCase())
    .is('deleted_at', null)
    .maybeSingle<InviteKeyRow>();

  if (!data) return 'invalid';
  if (data.revoked_at) return 'invalid';
  if (data.expires_at && new Date(data.expires_at) < new Date()) return 'invalid';
  if (data.uses >= data.max_uses) return 'invalid';

  await db.from('invite_keys').update({ uses: data.uses + 1 }).eq('id', data.id);
  return data;
}
