"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { clientIp, looksAutomated, appOrigin } from "@/lib/request";
import { rateLimit, retryMessage, RULES } from "@/lib/rate-limit";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { mailEnabled, sendMail } from "@/lib/mail";
import {
  keyQuestionIds,
  validateQuestions,
  type CAnswers,
} from "@/lib/competition/schema";
import {
  availability,
  bangkokTimestamp,
  continuationPath,
  fillReceipt,
  hashToken,
  loadWorkflow,
  newContinuationToken,
  storeTeamFile,
  submissionReference,
  teamByToken,
} from "@/lib/competition/server";
import { teamCode } from "@/lib/competition/schema";

/**
 * What participants do: register a team, submit Round 1 work, confirm a
 * finalist place, and get a lost link back.
 *
 * Participants have no portal account. What identifies a team after it has
 * registered is the secret continuation link (a 256-bit token, stored only as
 * a hash). A team ID is printed on folders and posters, so it is a reference
 * and never a password, and an email typed into a box proves nothing; the
 * recovery form below therefore *sends* a new link to the registered address
 * instead of showing one.
 */

export type RegisterState = {
  error?: string;
  field?: string;
  done?: {
    teamCode: string;
    teamName: string;
    receipt: string;
    continueUrl: string;
    emailed: boolean;
  };
};

export type StageState = {
  error?: string;
  field?: string;
  done?: { receipt: string; reference: string; at: string };
};

const PUBLIC_RULE = { limit: 10, windowMs: 10 * 60 * 1000, blockMs: 15 * 60 * 1000 };

function idempotencyKeyFrom(formData: FormData): string | null {
  const key = String(formData.get("idempotencyKey") ?? "");
  return /^[A-Za-z0-9-]{16,64}$/.test(key) ? key : null;
}

function isUniqueClash(error: unknown): boolean {
  return (error as { code?: string })?.code === "P2002";
}

function fileFromForm(formData: FormData, name: string): File | null {
  const value = formData.get(name);
  return value && typeof value === "object" && "size" in value && (value as File).size > 0 ? (value as File) : null;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerCompetitionTeam(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const formId = String(formData.get("formId") ?? "");
  const ip = await clientIp();

  const limit = rateLimit(`competition-register:${ip}`, PUBLIC_RULE);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  if (looksAutomated(formData)) {
    await audit(null, "competition.register.rejected", { type: "form", id: formId || undefined, detail: `Looked automated, from ${ip}` });
    return { error: "That did not go through. Please reload the page and try again." };
  }

  const loaded = await loadWorkflow(formId);
  if (!loaded) return { error: "This registration form is not available." };
  const { form, workflow, definition } = loaded;

  const state = availability(workflow);
  if (state !== "open") {
    return {
      error:
        state === "closed"
          ? "Registration has closed."
          : state === "not_yet_open"
            ? "Registration is not open yet."
            : "This registration form is not available.",
    };
  }

  const idempotencyKey = idempotencyKeyFrom(formData);
  if (!idempotencyKey) return { error: "Please reload the page and try again." };

  // A retry of a registration that already went through: same team, same ID.
  // The secret link is rotated, because the first response (the only place
  // the old one was shown) evidently never reached the person.
  const repeat = await db.competitionTeam.findUnique({ where: { idempotencyKey } });
  if (repeat) {
    if (repeat.workflowId !== workflow.id) return { error: "Please reload the page and try again." };
    return finishRegistration(repeat, form.id, definition.receipt, false);
  }

  const validated = validateQuestions(definition.sections, formData, { members: null, maxBytes: MAX_UPLOAD_BYTES });
  if (!validated.ok) return { error: validated.error, field: validated.field };

  const keys = keyQuestionIds(workflow.track);
  const teamName = validated.answers[keys.teamName] ?? "";
  const representativeEmail = (validated.answers[keys.representativeEmail] ?? "").toLowerCase();
  if (!teamName || !representativeEmail) return { error: "Team name and Member 1's email are required." };

  // The id is chosen here so files can be stored against it before the row
  // exists. If the transaction then fails, those files belong to nothing and
  // no permission check will ever hand them out.
  const teamId = `ct${randomBytes(12).toString("hex")}`;
  const fileIds: Record<string, string> = {};
  for (const question of validated.shown) {
    const file = validated.files[question.id] ? fileFromForm(formData, `c_${question.id}`) : null;
    if (!file) continue;
    const parentType = question.type === "document" ? "competition_identity" : "competition_team";
    fileIds[question.id] = await storeTeamFile(file, parentType, teamId, form.ownerId);
  }

  const token = newContinuationToken();
  const registration = {
    answers: validated.answers,
    files: fileIds,
    shown: validated.shown.map((q) => q.id),
    flags: validated.flags,
  };

  let created;
  for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
    try {
      created = await db.$transaction(async (tx) => {
        await tx.competitionCounter.upsert({
          where: { year_track: { year: workflow.year, track: workflow.track } },
          create: { year: workflow.year, track: workflow.track, next: 0 },
          update: {},
        });
        // One UPDATE … SET next = next + 1: two registrations at the same
        // moment can never read the same number.
        const counter = await tx.competitionCounter.update({
          where: { year_track: { year: workflow.year, track: workflow.track } },
          data: { next: { increment: 1 } },
        });
        const seq = counter.next;
        return tx.competitionTeam.create({
          data: {
            id: teamId,
            workflowId: workflow.id,
            year: workflow.year,
            track: workflow.track,
            seq,
            teamCode: teamCode(workflow.track, seq),
            teamName,
            memberCount: validated.memberCount,
            representativeEmail,
            registration,
            schemaVersion: workflow.version,
            idempotencyKey,
            continuationHash: hashToken(token),
            paymentStatus: workflow.track === "internal" ? "not_required" : "pending",
            paymentFlag: validated.flags.length ? validated.flags.join("; ").slice(0, 300) : null,
          },
        });
      });
    } catch (error) {
      if (!isUniqueClash(error)) throw error;
      // Either a double-click landed first (same idempotency key), or two
      // brand-new counters raced to be created. Look, then retry.
      const winner = await db.competitionTeam.findUnique({ where: { idempotencyKey } });
      if (winner) return finishRegistration(winner, form.id, definition.receipt, false);
    }
  }
  if (!created) return { error: "We could not save that just now. Please try again in a moment." };

  await audit(null, "competition.registered", {
    type: "form",
    id: form.id,
    detail: `Registered ${created.teamCode} "${created.teamName}" (${created.memberCount} member${created.memberCount === 1 ? "" : "s"}) from ${ip}`,
  });
  revalidatePath(`/forms/${form.id}`);

  return finishRegistration(created, form.id, definition.receipt, true, token);
}

async function finishRegistration(
  team: { id: string; teamCode: string; teamName: string; representativeEmail: string },
  formId: string,
  receiptTemplate: string,
  fresh: boolean,
  existingToken?: string,
): Promise<RegisterState> {
  let token = existingToken;
  if (!token) {
    token = newContinuationToken();
    await db.competitionTeam.update({
      where: { id: team.id },
      data: { continuationHash: hashToken(token), continuationIssuedAt: new Date() },
    });
  }
  const origin = await appOrigin();
  const continueUrl = `${origin}${continuationPath(formId, token)}`;
  const emailed = fresh ? await emailLink(team.representativeEmail, team.teamCode, team.teamName, continueUrl) : false;

  return {
    done: {
      teamCode: team.teamCode,
      teamName: team.teamName,
      receipt: fillReceipt(receiptTemplate, { teamId: team.teamCode }),
      continueUrl,
      emailed,
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function emailLink(to: string, code: string, teamName: string, url: string): Promise<boolean> {
  if (!mailEnabled()) return false;
  const subject = `KMIDS Hackathon 2027: your team link (${code})`;
  const text =
    `Your team ${teamName} is registered as ${code}.\n\n` +
    `Use this private link to submit your Round 1 work before the deadline:\n${url}\n\n` +
    `Anyone with this link can submit for your team, so keep it within your team.`;
  const html =
    `<p>Your team <strong>${escapeHtml(teamName)}</strong> is registered as <strong>${escapeHtml(code)}</strong>.</p>` +
    `<p>Use this private link to submit your Round 1 work before the deadline:</p>` +
    `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` +
    `<p>Anyone with this link can submit for your team, so keep it within your team.</p>`;
  return sendMail(to, subject, html, text);
}

// ---------------------------------------------------------------------------
// Lost link
// ---------------------------------------------------------------------------

/**
 * Emails a fresh link to the registered representative. The page always says
 * the same thing, whether or not the team ID and email matched, so the form
 * cannot be used to find out which teams exist or who represents them.
 */
export async function recoverTeamLink(
  _prev: { ok?: string; error?: string },
  formData: FormData,
): Promise<{ ok?: string; error?: string }> {
  const formId = String(formData.get("formId") ?? "");
  const ip = await clientIp();
  const limit = rateLimit(`competition-recover:${ip}`, RULES.recovery);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };
  if (looksAutomated(formData)) return { ok: SAME_ANSWER };

  if (!mailEnabled()) {
    return { error: "Email is not set up for this form yet. Please contact the organizers for a new link." };
  }

  const loaded = await loadWorkflow(formId);
  if (!loaded || loaded.workflow.status !== "published") return { ok: SAME_ANSWER };

  const code = String(formData.get("teamCode") ?? "").trim().toLowerCase();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^(internal|external)\d{2,6}$/.test(code) || email.length > 254) return { ok: SAME_ANSWER };

  const team = await db.competitionTeam.findFirst({
    where: { workflowId: loaded.workflow.id, teamCode: code },
  });
  if (team && team.representativeEmail === email) {
    const token = newContinuationToken();
    await db.competitionTeam.update({
      where: { id: team.id },
      data: { continuationHash: hashToken(token), continuationIssuedAt: new Date() },
    });
    const url = `${await appOrigin()}${continuationPath(loaded.form.id, token)}`;
    await emailLink(team.representativeEmail, team.teamCode, team.teamName, url);
    await audit(null, "competition.link.reissued", {
      type: "form",
      id: loaded.form.id,
      detail: `New team link emailed for ${team.teamCode} (the old one no longer works)`,
    });
  }
  return { ok: SAME_ANSWER };
}

const SAME_ANSWER =
  "If that team ID and email match a registration, a new link is on its way to the representative's inbox. Any older link stops working. Check junk and spam too.";

// ---------------------------------------------------------------------------
// Stage F: Round 1 work
// ---------------------------------------------------------------------------

export async function submitRoundOne(_prev: StageState, formData: FormData): Promise<StageState> {
  return submitStage("F", formData);
}

export async function submitFinalistConfirmation(_prev: StageState, formData: FormData): Promise<StageState> {
  return submitStage("H", formData);
}

async function submitStage(stage: "F" | "H", formData: FormData): Promise<StageState> {
  const ip = await clientIp();
  const limit = rateLimit(`competition-stage:${ip}`, PUBLIC_RULE);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };
  if (looksAutomated(formData)) return { error: "That did not go through. Please reload the page and try again." };

  const formId = String(formData.get("formId") ?? "");
  const token = String(formData.get("token") ?? "");

  const loaded = await loadWorkflow(formId);
  const team = await teamByToken(token);
  // The link has to belong to this very form. A link from the internal track
  // never opens an external team, whatever the URL says.
  if (!loaded || !team || team.workflowId !== loaded.workflow.id) {
    return { error: "This link is not valid any more. Use the newest link sent to your team." };
  }
  const { workflow, definition } = loaded;

  if (team.registrationStatus === "withdrawn" || team.registrationStatus === "rejected") {
    return { error: "This registration is no longer active. Please contact the organizers." };
  }

  if (stage === "F") {
    const state = availability(workflow);
    if (state !== "open") {
      return { error: state === "closed" ? "The Round 1 deadline has passed." : "Round 1 submission is not open." };
    }
  } else {
    // Stage H is a private draft until the owner switches it on, and then only
    // for teams staff have marked as finalists.
    if (workflow.status !== "published" || !workflow.stageHActive || !team.finalist) {
      return { error: "This step is not available." };
    }
  }

  const existing = team.submissions.find((s) => s.stage === stage);
  if (existing && existing.status === "final") {
    return { error: "Your answers are already submitted and locked." };
  }

  const memberNames = Array.from({ length: team.memberCount }, (_, i) => {
    const answers = (team.registration as { answers?: CAnswers }).answers ?? {};
    return answers[keyQuestionIds(workflow.track).memberName(i + 1)] ?? `Member ${i + 1}`;
  });

  const stageDef = stage === "F" ? definition.f : definition.h;
  const validated = validateQuestions(stageDef.sections, formData, {
    members: team.memberCount,
    maxBytes: MAX_UPLOAD_BYTES,
    memberNames,
  });
  if (!validated.ok) return { error: validated.error, field: validated.field };
  if (Object.keys(validated.files).length > 0) return { error: "This step does not take file uploads." };

  const now = new Date();
  const reference = submissionReference(stage, team.teamCode);
  // A reopened entry keeps what it said before, so a staff correction is never
  // a silent overwrite.
  const previous = existing?.payload as { history?: Prisma.InputJsonValue[] } | undefined;
  const history: Prisma.InputJsonValue[] = existing
    ? [...(previous?.history ?? []), existing.payload as Prisma.InputJsonValue]
    : [];
  const payload = { answers: validated.answers, shown: validated.shown.map((q) => q.id), history };

  try {
    if (existing) {
      // Only a row staff reopened gets here (status "reopened"). The update is
      // conditional, so two tabs cannot both turn it final.
      const updated = await db.competitionSubmission.updateMany({
        where: { id: existing.id, status: "reopened" },
        data: {
          status: "final",
          payload,
          schemaVersion: workflow.version,
          reference,
          finalizedAt: now,
          archiveStatus: "not_archived",
          archivedAt: null,
          archivedById: null,
        },
      });
      if (updated.count === 0) return { error: "Your answers are already submitted and locked." };
    } else {
      await db.competitionSubmission.create({
        data: {
          teamId: team.id,
          stage,
          status: "final",
          payload,
          schemaVersion: workflow.version,
          reference,
          finalizedAt: now,
        },
      });
    }
  } catch (error) {
    if (isUniqueClash(error)) return { error: "Your answers are already submitted and locked." };
    throw error;
  }

  await audit(null, stage === "F" ? "competition.round1.submitted" : "competition.finalist.confirmed", {
    type: "form",
    id: loaded.form.id,
    detail: `${team.teamCode} submitted stage ${stage} (${reference})`,
  });
  revalidatePath(`/forms/${loaded.form.id}`);

  const at = bangkokTimestamp(now);
  return {
    done: {
      reference,
      at,
      receipt: fillReceipt(stageDef.receipt, { teamId: team.teamCode, BangkokTimestamp: at, submissionReference: reference }),
    },
  };
}
