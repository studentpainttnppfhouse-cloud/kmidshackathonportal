"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireViewer, isAdmin } from "@/lib/authorize";
import { emailSchema, generateCode, normalizeEmail, usernameSchema } from "@/lib/auth";
import { RESET_TTL_HOURS, TIER_LABEL, TIER_ORDER } from "@/lib/constants";
import { RULES, rateLimit, retryMessage } from "@/lib/rate-limit";
import { appOrigin, clientIp, displayIp, looksAutomated } from "@/lib/request";
import type { FormState } from "@/lib/actions/auth";
import { mailEnabled, resetEmail, sendMail } from "@/lib/mail";
import type { RecoveryKind, Tier } from "@prisma/client";
import type { Viewer } from "@/lib/policy";

/**
 * People: adding someone, handing out reset links, and the account recovery
 * queue. Admin and owner only, except `requestRecovery`, which is public.
 */

const TIERS = ["T0_ADVISOR", "T1_MEMBER", "T2_HEAD", "T3_ADMIN", "T4_OWNER"] as const satisfies readonly Tier[];

const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export type LinkState = FormState & { url?: string };

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

/**
 * Burn any open reset links for the person and issue a new one. Returns the
 * absolute URL to hand over; the code itself is never written to the audit log.
 */
async function issueResetFor(
  viewer: Viewer,
  userId: string,
  reason: string,
): Promise<{ url: string; resetId: string } | { error: string }> {
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, nickname: true, tier: true, deletedAt: true },
  });
  if (!target || target.deletedAt) return { error: "That person no longer exists." };
  if (TIER_ORDER[target.tier] > TIER_ORDER[viewer.tier]) {
    await audit(viewer.id, "password.reset.denied", {
      result: "denied",
      type: "user",
      id: userId,
      detail: `Refused a reset link for ${displayName(target)}: their tier is above yours.`,
    });
    return { error: "You cannot issue a reset link for somebody above your own tier." };
  }

  await db.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  const reset = await db.passwordReset.create({
    data: {
      userId,
      code: generateCode(),
      issuedById: viewer.id,
      expiresAt: new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  await audit(viewer.id, "password.reset.issued", {
    type: "user",
    id: userId,
    detail: `${displayName(viewer)} issued a password reset link for ${displayName(target)}. Reason: ${reason}`.slice(0, 1000),
  });

  return { url: `${await appOrigin()}/reset/${reset.code}`, resetId: reset.id };
}

/** Tell every active admin and owner something, in the portal. */
async function noticeAdmins(title: string, body: string, href: string): Promise<void> {
  const admins = await db.user.findMany({
    where: { tier: { in: ["T3_ADMIN", "T4_OWNER"] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await db.portalNotice.createMany({
    data: admins.map((a) => ({ userId: a.id, title: title.slice(0, 190), body, href })),
  });
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

  const link = await issueResetFor(viewer, user.id, "first-time password setup for a newly added person");
  revalidatePath("/people");
  if ("error" in link) return { ok: `${d.name} was added, but no setup link could be made: ${link.error}` };
  return {
    ok: `${d.name} is in. Send them this link to choose a password (valid ${RESET_TTL_HOURS} hours).`,
    url: link.url,
  };
}

// ---------------------------------------------------------------------------
// Reset link for one person
// ---------------------------------------------------------------------------

export async function generateResetLink(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const viewer = await requireAdminViewer("issue a password reset link");
  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300) || "issued from the People page";

  const link = await issueResetFor(viewer, userId, reason);
  if ("error" in link) return { error: link.error };

  revalidatePath(`/people/${userId}`);
  return {
    ok: `Reset link ready. It works once and expires in ${RESET_TTL_HOURS} hours. Opening it signs out their other devices.`,
    url: link.url,
  };
}

// ---------------------------------------------------------------------------
// Account recovery: public request, admin decision
// ---------------------------------------------------------------------------

const KINDS = ["USERNAME", "PASSWORD", "EMAIL", "OTHER"] as const satisfies readonly RecoveryKind[];

const KIND_LABEL: Record<RecoveryKind, string> = {
  USERNAME: "forgot their username",
  PASSWORD: "forgot their password",
  EMAIL: "forgot which email they use",
  OTHER: "needs help signing in",
};

const recoverySchema = z.object({
  kind: z.enum(KINDS),
  contact: z.string().trim().min(3, "Tell us an email or your full name.").max(190),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  message: z.string().trim().max(1000, "Keep the message under 1000 characters.").optional().or(z.literal("")),
});

const EMAIL_RESET_MINUTES = 30;

/** Returns true when the request is handled (sent, or quietly skipped), false to fall back to admins. */
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
  const ip = await clientIp();
  const thanks =
    "Thanks. An admin will look at your request and get back to you with a reset link. You can close this page.";

  const limit = rateLimit(`recovery:${ip}`, RULES.recovery);
  if (!limit.ok) {
    await audit(null, "recovery.rate_limited", {
      result: "denied",
      type: "recovery",
      detail: "A recovery request was refused because the connection sent too many.",
    });
    return { error: retryMessage(limit.retryAfter) };
  }

  if (looksAutomated(formData)) {
    await audit(null, "recovery.bot_blocked", {
      result: "denied",
      type: "recovery",
      detail: "A recovery request looked automated and was dropped.",
    });
    return { ok: thanks };
  }

  const parsed = recoverySchema.safeParse({
    kind: formData.get("kind") ?? "PASSWORD",
    contact: formData.get("contact") ?? "",
    name: formData.get("name") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Best-effort match so the admin sees who it probably is. Never revealed to
  // the requester: the answer is the same whether or not anyone matched.
  const contact = d.contact.includes("@") ? normalizeEmail(d.contact) : d.contact;
  const match = await db.user.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { email: contact },
        { username: contact.toLowerCase() },
        { name: d.name || contact },
        { name: contact },
      ],
    },
    select: { id: true },
  });

  // Self-service: a forgotten password for an exact email match gets the reset
  // link by email. Same reply either way, so the form never reveals accounts.
  if (d.kind === "PASSWORD" && d.contact.includes("@") && mailEnabled()) {
    const mailed = await emailResetLink(contact);
    if (mailed) return { ok: "If that email has an account, we sent a reset link to it. Check your inbox and spam folder." };
  }

  const request = await db.recoveryRequest.create({
    data: {
      kind: d.kind,
      contact: d.contact,
      name: d.name || null,
      message: d.message || null,
      matchedUserId: match?.id ?? null,
      ip: (await displayIp())?.slice(0, 64) ?? null,
    },
  });

  const who = d.name || d.contact;
  await audit(null, "recovery.requested", {
    type: "recovery",
    id: request.id,
    detail: `${who} ${KIND_LABEL[d.kind]} and asked for help.${match ? "" : " No account matched what they typed."}`.slice(0, 1000),
  });
  await noticeAdmins(
    `Account recovery: ${who} ${KIND_LABEL[d.kind]}`,
    d.message || "No message.",
    "/people?tab=requests",
  );

  return { ok: thanks };
}

export async function approveRecovery(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const viewer = await requireAdminViewer("approve an account recovery request");
  const id = String(formData.get("id") ?? "");
  const userId = String(formData.get("userId") ?? "");

  const req = await db.recoveryRequest.findUnique({ where: { id } });
  if (!req || req.status !== "PENDING") return { error: "That request has already been handled." };
  if (!userId) return { error: "Pick whose account this is first." };

  const link = await issueResetFor(viewer, userId, `approved account recovery request from ${req.name || req.contact}`);
  if ("error" in link) return { error: link.error };

  const claimed = await db.recoveryRequest.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: "APPROVED",
      resolvedById: viewer.id,
      resolvedAt: new Date(),
      matchedUserId: userId,
      resetId: link.resetId,
      resolution: "Reset link issued.",
    },
  });
  if (claimed.count === 0) return { error: "Somebody else handled that request a moment ago." };

  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, username: true } });
  await audit(viewer.id, "recovery.approved", {
    type: "recovery",
    id,
    detail: `${displayName(viewer)} approved the recovery request from ${req.name || req.contact} and issued a reset link.`,
  });

  revalidatePath("/people");
  return {
    ok: `Approved. Send this link to ${req.contact}. Their email is ${user?.email ?? "unknown"}${user?.username ? `, username ${user.username}` : ""}.`,
    url: link.url,
  };
}

export async function denyRecovery(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireAdminViewer("deny an account recovery request");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || "No reason given.";

  const req = await db.recoveryRequest.findUnique({ where: { id } });
  const claimed = await db.recoveryRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "DENIED", resolvedById: viewer.id, resolvedAt: new Date(), resolution: reason },
  });
  if (!req || claimed.count === 0) return { error: "That request has already been handled." };

  await audit(viewer.id, "recovery.denied", {
    type: "recovery",
    id,
    detail: `${displayName(viewer)} denied the recovery request from ${req.name || req.contact}. Reason: ${reason}`,
  });
  revalidatePath("/people");
  return { ok: "Denied." };
}

/** Marks this viewer's recovery notices read once they open the Requests tab. */
export async function markRecoveryNoticesRead(): Promise<void> {
  const viewer = await requireViewer();
  await db.portalNotice.updateMany({
    where: { userId: viewer.id, readAt: null, href: "/people?tab=requests" },
    data: { readAt: new Date() },
  });
}
