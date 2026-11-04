"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, requireViewer, isAdmin } from "@/lib/authorize";
import { emailSchema, generateCode } from "@/lib/auth";
import { INVITE_TTL_DAYS, TIER_ORDER, tierForRole } from "@/lib/constants";
import { RULES, rateLimit, retryMessage } from "@/lib/rate-limit";
import type { FormState } from "@/lib/actions/auth";
import type { Tier } from "@prisma/client";

const USER_FLAGS = ["isReserve", "isMentor", "isAlumni", "isActive"] as const;
type UserFlag = (typeof USER_FLAGS)[number];

const TIERS = [
  "T0_ADVISOR",
  "T1_MEMBER",
  "T2_HEAD",
  "T3_ADMIN",
  "T4_OWNER",
] as const satisfies readonly Tier[];

// ---------------------------------------------------------------------------
// Invites — the only way into the portal. There is no open sign-up page.
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, "Give the person's name.").max(120),
  roleTitle: z.string().trim().max(80).optional().or(z.literal("")),
  tier: z.enum(TIERS),
  departmentId: z.string().optional().or(z.literal("")),
});

/**
 * An invite plus the link that goes with it.
 *
 * The link is handed straight back to the form rather than left to be dug out
 * of the pending list: the portal sends no email, so "copy this and send it on
 * LINE" is the entire delivery mechanism, and it should be one click away from
 * the moment the invite exists.
 */
export type InviteState = FormState & { code?: string; email?: string };

export async function createInvite(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_users", { kind: "user", userId: viewer.id });

  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  // Name and email are the whole required form. Everything else — team, role,
  // tier — is optional here and set later from the user list, because getting
  // somebody an account should not wait on deciding what they will be doing.
  const roleTitle = String(formData.get("roleTitle") ?? "").trim();
  const tierField = String(formData.get("tier") ?? "").trim();

  const parsed = inviteSchema.safeParse({
    email: formData.get("email") ?? "",
    name: formData.get("name") ?? "",
    roleTitle,
    // A role implies a tier. Posting no tier at all means "whatever the role
    // says", and a role nobody recognises means the safest one.
    tier: tierField || tierForRole(roleTitle) || "T1_MEMBER",
    departmentId: formData.get("departmentId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Nobody hands out a tier above their own. Stated as an ordering rather than
  // a special case for T4, so a tier added later cannot be escalated into by an
  // admin who happens to be below it.
  if (TIER_ORDER[d.tier] > TIER_ORDER[viewer.tier]) {
    return { error: "You cannot invite somebody at a higher tier than your own." };
  }

  if (d.departmentId) {
    const department = await db.department.findUnique({
      where: { id: d.departmentId },
      select: { id: true },
    });
    if (!department) return { error: "That department no longer exists." };
  }

  const existing = await db.user.findUnique({ where: { email: d.email } });
  if (existing?.passwordHash) {
    return { error: "That person already has an account. They can use Forgot password to receive a reset email." };
  }

  const invite = await db.invite.create({
    data: {
      email: d.email,
      code: generateCode(),
      name: d.name || null,
      roleTitle: d.roleTitle || null,
      tier: d.tier,
      departmentId: d.departmentId || null,
      invitedById: viewer.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  await audit(viewer.id, "invite.created", { type: "invite", id: invite.id, detail: d.email });
  revalidatePath("/admin");
  return {
    ok: `Invite ready for ${d.name}. Copy the link and send it on LINE.`,
    code: invite.code,
    email: d.email,
  };
}

export async function revokeInvite(id: string): Promise<void> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_users", { kind: "user", userId: viewer.id });

  // updateMany, not update: an id that matches nothing is a no-op rather than
  // a thrown P2025 that surfaces as a 500 page.
  await db.invite.updateMany({
    where: { id, revokedAt: null, acceptedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit(viewer.id, "invite.revoked", { type: "invite", id });
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function setUserTier(userId: string, tier: Tier): Promise<void> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_users", { kind: "user", userId });

  // A server action argument is browser input. `tier: Tier` is a compile-time
  // claim; this is the run-time one.
  if (!(tier in TIER_ORDER)) return;

  // Granting a tier you do not hold yourself is privilege escalation whichever
  // direction it comes from.
  if (TIER_ORDER[tier] > TIER_ORDER[viewer.tier]) return;
  if (userId === viewer.id) return; // no self-demotion locking you out

  const target = await db.user.findUnique({ where: { id: userId }, select: { tier: true } });
  if (!target) return;
  // Nor may an admin demote somebody above them and take the account over.
  if (TIER_ORDER[target.tier] > TIER_ORDER[viewer.tier]) return;

  await db.user.update({ where: { id: userId }, data: { tier } });
  await audit(viewer.id, "user.tier.changed", { type: "user", id: userId, detail: tier });
  revalidatePath("/admin");
  revalidatePath(`/people/${userId}`);
}

export async function setUserDepartment(userId: string, departmentId: string): Promise<void> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_departments", { kind: "user", userId });

  if (departmentId) {
    const department = await db.department.findUnique({
      where: { id: departmentId },
      select: { id: true },
    });
    if (!department) return;
  }

  await db.user.update({
    where: { id: userId },
    data: { departmentId: departmentId || null },
  });
  await audit(viewer.id, "user.department.changed", { type: "user", id: userId });
  revalidatePath("/admin");
  revalidatePath("/people");
  revalidatePath(`/people/${userId}`);
}

/**
 * Sets somebody's role on the staff chart, and the tier that role implies.
 *
 * The two travel together on purpose. A "Graphics Head" whose account is still
 * T1 cannot approve their own team's work, which is the sort of mismatch that
 * gets noticed the week of the event. The tier still cannot exceed the
 * viewer's own, so this is not a way around the ceiling in setUserTier.
 */
export async function setUserRole(userId: string, roleTitle: string): Promise<void> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_users", { kind: "user", userId });

  const title = String(roleTitle ?? "").trim().slice(0, 80);
  const implied = title ? tierForRole(title) : null;

  const target = await db.user.findUnique({ where: { id: userId }, select: { tier: true } });
  if (!target) return;

  // The role is free to change. The tier that comes with it only follows when
  // the viewer holds that tier themselves, the target is not above them, and
  // it is not the viewer's own account — the same three rules setUserTier
  // enforces, because this is the same power by another name.
  const promote =
    implied !== null &&
    userId !== viewer.id &&
    TIER_ORDER[implied] <= TIER_ORDER[viewer.tier] &&
    TIER_ORDER[target.tier] <= TIER_ORDER[viewer.tier];

  await db.user.update({
    where: { id: userId },
    data: { roleTitle: title || null, ...(promote ? { tier: implied } : {}) },
  });

  await audit(viewer.id, "user.role.changed", { type: "user", id: userId, detail: title });
  revalidatePath("/admin");
  revalidatePath("/people");
  revalidatePath(`/people/${userId}`);
}

export async function setUserFlag(userId: string, flag: UserFlag, value: boolean): Promise<void> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_users", { kind: "user", userId });

  // `flag` is used as an object key in the update payload, so it decides which
  // column gets written. The type says it is one of four; this says so at run
  // time, where the value actually arrives from a POST body.
  if (!USER_FLAGS.includes(flag)) return;
  if (typeof value !== "boolean") return;

  if (userId === viewer.id && flag === "isActive" && !value) return;

  const target = await db.user.findUnique({ where: { id: userId }, select: { tier: true } });
  if (!target) return;
  if (TIER_ORDER[target.tier] > TIER_ORDER[viewer.tier]) return;

  await db.user.update({ where: { id: userId }, data: { [flag]: value } });
  await audit(viewer.id, `user.${flag}`, { type: "user", id: userId, detail: String(value) });
  revalidatePath("/admin");
}

/** Clears a lockout after five failed sign-ins without touching the password. */
export async function unlockUser(userId: string): Promise<void> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_users", { kind: "user", userId });

  await db.user.update({
    where: { id: userId },
    data: { failedLogins: 0, lockedUntil: null },
  });
  await audit(viewer.id, "user.unlocked", { type: "user", id: userId });
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Used both by an owner in the admin panel and by anyone on their own devices. */
export async function revokeSession(sessionId: string): Promise<void> {
  const viewer = await requireViewer();

  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  });
  if (!session) return;

  const mine = session.userId === viewer.id;
  if (!mine) assertCan(viewer, "manage_sessions", { kind: "user", userId: session.userId });

  await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  await audit(viewer.id, "session.revoked", { type: "session", id: sessionId });

  revalidatePath("/settings");
  revalidatePath("/admin");
}

export async function revokeAllSessionsFor(userId: string): Promise<void> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_sessions", { kind: "user", userId });

  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit(viewer.id, "session.revoked.all", { type: "user", id: userId });
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

const departmentSchema = z.object({
  name: z.string().trim().min(2, "Name the department.").max(80),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only."),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex colour like #EC4899"),
  headUserId: z.string().optional().or(z.literal("")),
});

export async function upsertDepartment(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  assertCan(viewer, "manage_departments", { kind: "system" });

  const id = String(formData.get("id") ?? "");
  const parsed = departmentSchema.safeParse({
    name: formData.get("name") ?? "",
    slug: formData.get("slug") ?? "",
    description: formData.get("description") ?? "",
    color: formData.get("color") ?? "#EC4899",
    headUserId: formData.get("headUserId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (d.headUserId) {
    const head = await db.user.findFirst({
      where: { id: d.headUserId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!head) return { error: "That person is not on the team any more." };
  }

  const data = {
    name: d.name,
    slug: d.slug,
    description: d.description || null,
    color: d.color,
    headUserId: d.headUserId || null,
  };

  if (id) {
    await db.department.update({ where: { id }, data });
    // The head of a department belongs to it.
    if (d.headUserId) {
      await db.user.update({ where: { id: d.headUserId }, data: { departmentId: id } });
    }
    await audit(viewer.id, "department.updated", { type: "department", id });
  } else {
    const created = await db.department.create({ data });
    if (d.headUserId) {
      await db.user.update({
        where: { id: d.headUserId },
        data: { departmentId: created.id },
      });
    }
    await audit(viewer.id, "department.created", { type: "department", id: created.id });
  }

  revalidatePath("/admin");
  revalidatePath("/departments");
  return { ok: "Saved." };
}

// ---------------------------------------------------------------------------
// Export & archive — the two things that make the 2028 handover possible.
// ---------------------------------------------------------------------------

export async function setArchiveMode(on: boolean): Promise<void> {
  const viewer = await requireViewer();
  assertCan(viewer, "archive", { kind: "system" });

  await db.setting.upsert({
    where: { key: "archive_mode" },
    create: { key: "archive_mode", value: on ? "1" : "0" },
    update: { value: on ? "1" : "0" },
  });

  await audit(viewer.id, on ? "archive.enabled" : "archive.disabled");
  revalidatePath("/admin");
}

export async function restoreDeleted(
  type: "assignment" | "document" | "file" | "announcement",
  id: string,
): Promise<void> {
  const viewer = await requireViewer();
  if (!isAdmin(viewer)) return;
  if (!["assignment", "document", "file", "announcement"].includes(type)) return;

  const data = { deletedAt: null };
  if (type === "assignment") await db.assignment.update({ where: { id }, data });
  if (type === "document") await db.document.update({ where: { id }, data });
  if (type === "file") await db.fileAsset.update({ where: { id }, data });
  if (type === "announcement") await db.announcement.update({ where: { id }, data });

  await audit(viewer.id, `${type}.restored`, { type, id });
  revalidatePath("/admin");
}
