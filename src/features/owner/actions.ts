'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser, revokeAllSessions } from '@/lib/auth/session';
import { admin } from '@/lib/db/client';
import { audit, diffOf } from '@/lib/audit';
import { canManageUsers } from '@/lib/permissions';
import { TIERS, type Tier } from '@/lib/types';

/**
 * Owner Console mutations.
 *
 * These use the admin client deliberately: the privilege guard trigger in
 * 0020_identity.sql refuses tier and status changes from a normal token, which
 * is exactly what stops a student escalating. The Owner's authority is
 * established here, in the application, and then exercised with the service
 * role. Every single one of these writes an audit entry.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireOwner() {
  const user = await getSessionUser();
  if (!user) return { error: 'Not signed in' as const, user: null };
  if (!canManageUsers(user.tier)) return { error: 'Owner only' as const, user: null };
  // An Owner previewing a lower tier must not be able to change anything.
  if (user.impersonating) {
    return { error: 'Impersonation sessions are read-only' as const, user: null };
  }
  return { error: null, user };
}

const setTierSchema = z.object({ userId: z.string().uuid(), tier: z.enum(TIERS) });

export async function setUserTierAction(userId: string, tier: string): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = setTierSchema.safeParse({ userId, tier });
  if (!parsed.success) return { ok: false, error: 'Unknown tier' };

  const db = admin();
  const { data: before } = await db
    .from('users')
    .select('id, email, tier')
    .eq('id', parsed.data.userId)
    .maybeSingle();

  if (!before) return { ok: false, error: 'That account no longer exists.' };

  // Two Owners always exist (§4) — refuse the change that would leave zero.
  if (before.tier === 'T4' && parsed.data.tier !== 'T4') {
    const { count } = await db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('tier', 'T4')
      .eq('status', 'active')
      .is('deleted_at', null);
    if ((count ?? 0) <= 1) {
      return { ok: false, error: 'You cannot remove the last Owner.' };
    }
  }

  const { error } = await db
    .from('users')
    .update({ tier: parsed.data.tier })
    .eq('id', parsed.data.userId);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.tier_changed',
    targetType: 'user',
    targetId: parsed.data.userId,
    targetLabel: before.email,
    diff: diffOf({ tier: before.tier }, { tier: parsed.data.tier }),
  });

  revalidatePath('/owner');
  return { ok: true };
}

export async function setUserDepartmentAction(
  userId: string,
  departmentId: string | null,
): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = z
    .object({ userId: z.string().uuid(), departmentId: z.string().uuid().nullable() })
    .safeParse({ userId, departmentId: departmentId || null });
  if (!parsed.success) return { ok: false, error: 'Unknown department' };

  const db = admin();
  const { data: before } = await db
    .from('users')
    .select('email, department_id')
    .eq('id', parsed.data.userId)
    .maybeSingle();

  const { error } = await db
    .from('users')
    .update({ department_id: parsed.data.departmentId })
    .eq('id', parsed.data.userId);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.department_changed',
    targetType: 'user',
    targetId: parsed.data.userId,
    targetLabel: before?.email ?? null,
    diff: diffOf(
      { department_id: before?.department_id ?? null },
      { department_id: parsed.data.departmentId },
    ),
  });

  revalidatePath('/owner');
  return { ok: true };
}

export async function setUserRoleTitleAction(
  userId: string,
  roleTitle: string,
): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = z.string().trim().max(120).safeParse(roleTitle);
  if (!parsed.success) return { ok: false, error: 'Role title is too long.' };

  const db = admin();
  const { error } = await db
    .from('users')
    .update({ role_title: parsed.data || null })
    .eq('id', userId);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.role_changed',
    targetType: 'user',
    targetId: userId,
    diff: { role_title: parsed.data },
  });

  revalidatePath('/owner');
  return { ok: true };
}

const suspendSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
  until: z.string().optional(),
});

export async function suspendUserAction(formData: FormData): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = suspendSchema.safeParse({
    userId: formData.get('userId'),
    reason: formData.get('reason') ?? '',
    until: (formData.get('until') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const db = admin();
  const { data: target } = await db
    .from('users')
    .select('email, tier')
    .eq('id', parsed.data.userId)
    .maybeSingle();

  if (target?.tier === 'T4') {
    return { ok: false, error: 'Transfer ownership before suspending an Owner.' };
  }

  const { error } = await db
    .from('users')
    .update({
      status: 'suspended',
      suspend_reason: parsed.data.reason,
      suspended_until: parsed.data.until ? new Date(parsed.data.until).toISOString() : null,
    })
    .eq('id', parsed.data.userId);

  if (error) return { ok: false, error: error.message };

  // Revoke their sessions so the suspension takes effect immediately (§3)
  // rather than whenever their cookie happens to expire.
  await revokeAllSessions(parsed.data.userId);

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.suspended',
    targetType: 'user',
    targetId: parsed.data.userId,
    targetLabel: target?.email ?? null,
    diff: { reason: parsed.data.reason, until: parsed.data.until ?? null },
  });

  revalidatePath('/owner');
  return { ok: true };
}

const banSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(1, 'A ban must record a reason').max(500),
});

export async function banUserAction(formData: FormData): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = banSchema.safeParse({
    userId: formData.get('userId'),
    reason: formData.get('reason') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'A reason is required.' };
  }

  const db = admin();
  const { data: target } = await db
    .from('users')
    .select('email, tier')
    .eq('id', parsed.data.userId)
    .maybeSingle();

  if (target?.tier === 'T4') {
    return { ok: false, error: 'Transfer ownership before banning an Owner.' };
  }

  const { error } = await db
    .from('users')
    .update({
      status: 'banned',
      ban_reason: parsed.data.reason,
      banned_by: user.id,
      banned_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.userId);

  if (error) return { ok: false, error: error.message };
  await revokeAllSessions(parsed.data.userId);

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.banned',
    targetType: 'user',
    targetId: parsed.data.userId,
    targetLabel: target?.email ?? null,
    diff: { reason: parsed.data.reason },
  });

  revalidatePath('/owner');
  return { ok: true };
}

export async function reinstateUserAction(userId: string): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const db = admin();
  const { data: before } = await db
    .from('users')
    .select('email, status')
    .eq('id', userId)
    .maybeSingle();

  const { error } = await db
    .from('users')
    .update({
      status: 'active',
      ban_reason: null,
      banned_by: null,
      banned_at: null,
      suspended_until: null,
      suspend_reason: null,
    })
    .eq('id', userId);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.reinstated',
    targetType: 'user',
    targetId: userId,
    targetLabel: before?.email ?? null,
    diff: diffOf({ status: before?.status }, { status: 'active' }),
  });

  revalidatePath('/owner');
  return { ok: true };
}

/** Soft removal — the row stays for the audit trail (§2.2). */
export async function removeUserAction(userId: string): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const db = admin();
  const { data: target } = await db
    .from('users')
    .select('email, tier')
    .eq('id', userId)
    .maybeSingle();

  if (target?.tier === 'T4') {
    return { ok: false, error: 'Transfer ownership before removing an Owner.' };
  }

  const { error } = await db
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) return { ok: false, error: error.message };
  await revokeAllSessions(userId);

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.removed',
    targetType: 'user',
    targetId: userId,
    targetLabel: target?.email ?? null,
  });

  revalidatePath('/owner');
  return { ok: true };
}

/** Approve someone sitting in the access-request queue. */
export async function approveRequestAction(
  userId: string,
  tier: string,
  departmentId: string | null,
): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = z
    .object({
      userId: z.string().uuid(),
      tier: z.enum(TIERS),
      departmentId: z.string().uuid().nullable(),
    })
    .safeParse({ userId, tier, departmentId: departmentId || null });

  if (!parsed.success) return { ok: false, error: 'Pick a tier.' };

  const db = admin();
  const { data: target } = await db.from('users').select('email').eq('id', userId).maybeSingle();

  const { error } = await db
    .from('users')
    .update({
      status: 'active',
      tier: parsed.data.tier,
      department_id: parsed.data.departmentId,
    })
    .eq('id', parsed.data.userId);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.approved',
    targetType: 'user',
    targetId: userId,
    targetLabel: target?.email ?? null,
    diff: { tier: parsed.data.tier, department: parsed.data.departmentId },
  });

  revalidatePath('/owner');
  return { ok: true };
}

export async function rejectRequestAction(userId: string): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const db = admin();
  const { data: target } = await db.from('users').select('email').eq('id', userId).maybeSingle();

  const { error } = await db
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'user.rejected',
    targetType: 'user',
    targetId: userId,
    targetLabel: target?.email ?? null,
  });

  revalidatePath('/owner');
  return { ok: true };
}

/** Bulk invite. Accepts comma or newline separated addresses (§4A). */
const inviteSchema = z.object({
  emails: z.string().trim().min(1, 'Enter at least one email address'),
  tier: z.enum(TIERS),
  departmentId: z.string().uuid().nullable(),
  roleTitle: z.string().trim().max(120).optional(),
});

export async function sendInvitesAction(formData: FormData): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = inviteSchema.safeParse({
    emails: formData.get('emails') ?? '',
    tier: formData.get('tier') ?? 'T1',
    departmentId: (formData.get('departmentId') as string) || null,
    roleTitle: formData.get('roleTitle') ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const emails = [
    ...new Set(
      parsed.data.emails
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
    ),
  ];

  if (emails.length === 0) {
    return { ok: false, error: 'No valid email addresses found in that list.' };
  }

  const db = admin();
  const { error } = await db.from('invited_users').upsert(
    emails.map((email) => ({
      email,
      tier: parsed.data.tier,
      department_id: parsed.data.departmentId,
      role_title: parsed.data.roleTitle ?? null,
      invited_by: user.id,
      status: 'pending' as const,
    })),
    { onConflict: 'email' },
  );

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'invite.sent',
    targetType: 'invite',
    targetLabel: `${emails.length} invite(s)`,
    diff: { emails, tier: parsed.data.tier, department: parsed.data.departmentId },
  });

  revalidatePath('/owner');
  return { ok: true };
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const db = admin();
  const { data: before } = await db
    .from('invited_users')
    .select('email')
    .eq('id', inviteId)
    .maybeSingle();

  const { error } = await db
    .from('invited_users')
    .update({ status: 'revoked' })
    .eq('id', inviteId);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'invite.revoked',
    targetType: 'invite',
    targetId: inviteId,
    targetLabel: before?.email ?? null,
  });

  revalidatePath('/owner');
  return { ok: true };
}

/** Invite keys (§4B). */
const keySchema = z.object({
  label: z.string().trim().max(120).optional(),
  tier: z.enum(TIERS),
  departmentId: z.string().uuid().nullable(),
  maxUses: z.coerce.number().int().min(1).max(200),
  expiresAt: z.string().optional(),
});

export async function createInviteKeyAction(formData: FormData): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = keySchema.safeParse({
    label: formData.get('label') ?? undefined,
    tier: formData.get('tier') ?? 'T1',
    departmentId: (formData.get('departmentId') as string) || null,
    maxUses: formData.get('maxUses') ?? 1,
    expiresAt: (formData.get('expiresAt') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const code = generateKeyCode(parsed.data.tier);
  const db = admin();
  const { error } = await db.from('invite_keys').insert({
    code,
    label: parsed.data.label ?? null,
    tier: parsed.data.tier,
    department_id: parsed.data.departmentId,
    max_uses: parsed.data.maxUses,
    expires_at: parsed.data.expiresAt ? new Date(parsed.data.expiresAt).toISOString() : null,
    created_by: user.id,
  });

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'invite_key.created',
    targetType: 'invite_key',
    targetLabel: code,
    diff: { tier: parsed.data.tier, maxUses: parsed.data.maxUses },
  });

  revalidatePath('/owner');
  return { ok: true };
}

export async function revokeInviteKeyAction(keyId: string): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const db = admin();
  const { data: before } = await db
    .from('invite_keys')
    .select('code')
    .eq('id', keyId)
    .maybeSingle();

  const { error } = await db
    .from('invite_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId);

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'invite_key.revoked',
    targetType: 'invite_key',
    targetId: keyId,
    targetLabel: before?.code ?? null,
  });

  revalidatePath('/owner');
  return { ok: true };
}

/** Ownership transfer (§4). Cannot leave zero Owners. */
export async function transferOwnershipAction(targetUserId: string): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const db = admin();
  const { data: target } = await db
    .from('users')
    .select('id, email, status')
    .eq('id', targetUserId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!target) return { ok: false, error: 'That account no longer exists.' };
  if (target.status !== 'active') {
    return { ok: false, error: 'You can only transfer ownership to an active account.' };
  }

  const { error } = await db.from('users').update({ tier: 'T4' }).eq('id', targetUserId);
  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'ownership.transferred',
    targetType: 'user',
    targetId: targetUserId,
    targetLabel: target.email,
    diff: { from: user.email, to: target.email },
  });

  revalidatePath('/owner');
  return { ok: true };
}

/** Archive freeze (§5.13). */
export async function setArchiveFrozenAction(
  year: number,
  frozen: boolean,
): Promise<ActionResult> {
  const { error: authError, user } = await requireOwner();
  if (authError || !user) return { ok: false, error: authError ?? 'Owner only' };

  const parsed = z.number().int().min(2020).max(2100).safeParse(year);
  if (!parsed.success) return { ok: false, error: 'Unknown year' };

  const db = admin();
  if (frozen) {
    const { error } = await db
      .from('archived_years')
      .upsert({ year: parsed.data, frozen_by: user.id }, { onConflict: 'year' });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from('archived_years').delete().eq('year', parsed.data);
    if (error) return { ok: false, error: error.message };
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: frozen ? 'archive.frozen' : 'archive.unfrozen',
    targetType: 'year',
    targetLabel: String(parsed.data),
  });

  revalidatePath('/owner');
  return { ok: true };
}

function generateKeyCode(tier: Tier): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  let body = '';
  for (let i = 0; i < 6; i += 1) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${tier}-2027-${body}`;
}
