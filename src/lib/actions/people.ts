"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireViewer, isAdmin } from "@/lib/authorize";
import { emailSchema, generateCode, normalizeEmail, usernameSchema } from "@/lib/auth";
import { TIER_LABEL, TIER_ORDER } from "@/lib/constants";
import { RULES, rateLimit, retryMessage } from "@/lib/rate-limit";
import { appOrigin, clientIp, looksAutomated } from "@/lib/request";
import type { FormState } from "@/lib/actions/auth";
import { mailEnabled, resetEmail, sendMail } from "@/lib/mail";
import type { Tier } from "@prisma/client";
import type { Viewer } from "@/lib/policy";

/**
 * Admin account creation and public email-only password recovery.
 * Reset tokens are emailed to account holders, never returned to admins.
 */

const TIERS = ["T0_ADVISOR", "T1_MEMBER", "T2_HEAD", "T3_ADMIN", "T4_OWNER"] as const satisfies readonly Tier[];

const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export type LinkState = FormState;

function displayName(user: { name: string; nickname?: string | null }): string {
  return user.nickname || user.name;
}

async function requireAdminViewer(action: string): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!isAdmin(viewer)) {
    await audit(viewer.id, "access.denied", {
      result: "denied",
      type: "page",
      id: "people",
      detail: `Tried to ${action} without admin or owner rights.`,
    });
    throw new Error("Only admins and owners can do that.");
  }
  return viewer;
}

// ---------------------------------------------------------------------------
// Add a person
// ---------------------------------------------------------------------------

const addSchema = z.object({
  name: z.string().trim().min(1, "Give the person's name.").max(120),
  email: emailSchema,
  username: usernameSchema.optional().or(z.literal("")),
  tier: z.enum(TIERS),
  roleTitle: z.string().trim().max(80).optional().or(z.literal("")),
  departmentId: z.string().optional().or(z.literal("")),
});

export async function addPerson(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const viewer = await requireAdminViewer("add a person");

  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  const parsed = addSchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    username: String(formData.get("username") ?? "").trim().toLowerCase(),
    tier: formData.get("tier") ?? "T1_MEMBER",
    roleTitle: formData.get("roleTitle") ?? "",
    departmentId: formData.get("departmentId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (TIER_ORDER[d.tier] > TIER_ORDER[viewer.tier]) {
    await audit(viewer.id, "user.add_denied", {
      result: "denied",
      type: "user",
      detail: `Refused to add ${d.email} as ${TIER_LABEL[d.tier]}: above your own tier.`,
    });
    return { error: "You cannot add somebody at a higher tier than your own." };
  }

  if (d.departmentId) {
    const dept = await db.department.findUnique({ where: { id: d.departmentId }, select: { id: true } });
    if (!dept) return { error: "That department no longer exists." };
  }

  if (await db.user.findUnique({ where: { email: d.email }, select: { id: true } })) {
    return { error: "Somebody with that email is already in the portal." };
  }
  if (d.username && (await db.user.findUnique({ where: { username: d.username }, select: { id: true } }))) {
    return { error: "That username is taken." };
  }

  // Validate the picture before writing anything.
  const file = formData.get("avatar");
  let avatar: { mime: string; bytes: Buffer } | null = null;
  if (file instanceof File && file.size > 0) {
    if (!AVATAR_TYPES.has(file.type)) return { error: "The picture must be a PNG, JPEG or WebP image." };
    if (file.size > AVATAR_MAX_BYTES) return { error: "The picture must be 2 MB or smaller." };
    avatar = { mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
  }

  const user = await db.user.create({
    data: {
      name: d.name,
      email: d.email,
      username: d.username || null,
      tier: d.tier,
      roleTitle: d.roleTitle || null,
      departmentId: d.departmentId || null,
    },
  });

  if (avatar) {
    await db.avatarImage.create({ data: { userId: user.id, mime: avatar.mime, bytes: avatar.bytes } });
    await db.user.update({
      where: { id: user.id },
      data: { avatarUrl: `${await appOrigin()}/api/avatar/${user.id}?v=${Date.now()}` },
    });
  }

  await audit(viewer.id, "user.added", {
    type: "user",
    id: user.id,
    detail: `${displayName(viewer)} added ${d.name} (${d.email}) as ${TIER_LABEL[d.tier]}${d.roleTitle ? `, ${d.roleTitle}` : ""}.`,
  });

  const sent = mailEnabled() && await emailResetLink(user.email);
  revalidatePath("/people");
  return { ok: sent ? "Person added. A password setup link was emailed directly to them." : "Person added. They can use Forgot password to receive their setup link." };
}

const EMAIL_RESET_MINUTES = 30;

/** Returns true when the request is handled (sent, or quietly skipped), false when email sending fails. */
async function emailResetLink(email: string): Promise<boolean> {
  const perEmail = rateLimit(`recovery-mail:${email}`, RULES.recovery);
  if (!perEmail.ok) return true;

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, nickname: true, email: true, isActive: true, deletedAt: true },
  });
  if (!user || user.deletedAt || !user.isActive) {
    await audit(null, "recovery.email.no_account", {
      type: "recovery",
      detail: "A reset email was asked for an address with no active account. Nothing was sent.",
    });
    return true;
  }

  await db.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  const reset = await db.passwordReset.create({
    data: {
      userId: user.id,
      code: generateCode(),
      issuedById: user.id,
      expiresAt: new Date(Date.now() + EMAIL_RESET_MINUTES * 60 * 1000),
    },
  });
  const origin = await appOrigin();
  const mail = resetEmail(displayName(user), `${origin}/reset/${reset.code}`, origin, EMAIL_RESET_MINUTES);
  const sent = await sendMail(user.email, mail.subject, mail.html, mail.text);
  if (!sent) {
    await db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
    return false;
  }
  await audit(user.id, "password.reset.emailed", {
    type: "user",
    id: user.id,
    detail: `A password reset link was emailed to ${user.email}.`,
  });
  return true;
}

export async function requestRecovery(_prev: FormState, formData: FormData): Promise<FormState> {
  const success = "If that email has an active account, we sent a password reset link. Check your inbox, Junk and Spam folders. The link expires in 30 minutes.";
  const ip = await clientIp();
  const limit = rateLimit(`recovery:${ip}`, RULES.recovery);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };
  if (looksAutomated(formData)) return { ok: success };
  const parsed = emailSchema.safeParse(formData.get("email") ?? "");
  if (!parsed.success) return { error: "Enter the email address on your portal account." };
  if (!mailEnabled()) return { error: "Password reset email is temporarily unavailable. Please try again later." };
  const sent = await emailResetLink(normalizeEmail(parsed.data));
  if (!sent) return { error: "We could not send the reset email right now. Please try again shortly." };
  return { ok: success };
}
