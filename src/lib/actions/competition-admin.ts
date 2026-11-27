"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireViewer } from "@/lib/authorize";
import { canCompetition, type CompetitionOp, type Viewer } from "@/lib/policy";
import { appOrigin } from "@/lib/request";
import { rateLimit, retryMessage, RULES } from "@/lib/rate-limit";
import { installCompetitionTemplates } from "@/lib/competition/install";
import { buildTemplate } from "@/lib/competition/templates";
import {
  checkCompetitionDefinition,
  parseCompetitionDefinition,
  settingsSchema,
  unresolvedSettings,
  type CQuestion,
  type CSection,
  type CStage,
  type CompetitionDefinition,
  type Track,
} from "@/lib/competition/schema";
import {
  continuationPath,
  hashToken,
  loadWorkflow,
  newContinuationToken,
  parseBangkokLocal,
} from "@/lib/competition/server";

/**
 * Running the competition forms: installing, editing, publishing, reviewing.
 * Every action re-checks `canCompetition` itself; a hidden button is not a
 * permission.
 */

export type AdminState = { error?: string; ok?: string; link?: string };

async function guard(op: CompetitionOp, options: { publishDelegatedToAdmins?: boolean } = {}): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!canCompetition(viewer, op, options)) {
    await audit(viewer.id, "competition.denied", { type: "competition", detail: `Tried to ${op} without permission` });
    throw new Error("You do not have permission to do that.");
  }
  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) throw new Error(retryMessage(limit.retryAfter));
  return viewer;
}

function refresh(formId: string) {
  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`);
}

// ---------------------------------------------------------------------------
// Making forms
// ---------------------------------------------------------------------------

/** Puts the two 2027 drafts on the Forms page if they are not there yet. */
export async function installCompetitionDrafts(): Promise<void> {
  const viewer = await guard("edit");
  const result = await installCompetitionTemplates(db);
  if (!result.ownerFound) await installCompetitionTemplates(db, viewer.id);
  await audit(viewer.id, "competition.installed", {
    type: "competition",
    detail: result.created.length ? `Installed drafts: ${result.created.join(", ")}` : "Drafts were already installed",
  });
  revalidatePath("/forms");
}

/** A fresh, editable draft from a template. Never touches an existing form. */
export async function createFromTemplate(track: Track): Promise<void> {
  const viewer = await guard("edit");
  if (track !== "internal" && track !== "external") throw new Error("Unknown template.");
  const formId = await createWorkflow(viewer.id, buildTemplate(track), {}, "");
  await audit(viewer.id, "competition.created", { type: "form", id: formId, detail: `New ${track} Round 1 draft from template` });
  revalidatePath("/forms");
  redirect(`/forms/${formId}`);
}

/**
 * "Duplicate as draft": questions, wording and settings come across; teams,
 * answers, uploaded files, team links and the published state do not.
 */
export async function duplicateCompetition(formId: string): Promise<void> {
  const viewer = await guard("edit");
  const loaded = await loadWorkflow(formId);
  if (!loaded) throw new Error("That form no longer exists.");
  const copyId = await createWorkflow(viewer.id, loaded.definition, loaded.settings, " (copy)");
  await audit(viewer.id, "competition.duplicated", {
    type: "form",
    id: copyId,
    detail: `Duplicated "${loaded.form.title}" as a draft`,
  });
  revalidatePath("/forms");
  redirect(`/forms/${copyId}`);
}

async function createWorkflow(
  ownerId: string,
  definition: CompetitionDefinition,
  settings: object,
  suffix: string,
): Promise<string> {
  const title = `${definition.title}${suffix}`.slice(0, 200);
  const base = `hackathon-${definition.year}-${definition.track}-${Date.now().toString(36)}`;
  return db.$transaction(async (tx) => {
    const form = await tx.form.create({
      data: {
        title,
        description: "Competition form draft. Not public until the owner publishes it.",
        type: "internal",
        slug: base,
        ownerId,
        departmentId: null,
        isOpen: false,
        year: definition.year,
      },
      select: { id: true },
    });
    await tx.competitionWorkflow.create({
      data: {
        formId: form.id,
        year: definition.year,
        track: definition.track,
        templateKey: definition.templateKey,
        status: "draft",
        settings: { ...settings, publishDelegatedToAdmins: false } as Prisma.InputJsonValue,
        definition: { ...definition, title } as Prisma.InputJsonValue,
        version: 1,
      },
    });
    return form.id;
  });
}

// ---------------------------------------------------------------------------
// Settings and publishing
// ---------------------------------------------------------------------------

export async function saveCompetitionSettings(_prev: AdminState, formData: FormData): Promise<AdminState> {
  let viewer: Viewer;
  try {
    viewer = await guard("edit");
  } catch (error) {
    return { error: (error as Error).message };
  }
  const formId = String(formData.get("formId") ?? "");
  const loaded = await loadWorkflow(formId);
  if (!loaded) return { error: "That form no longer exists." };

  const text = (key: string) => String(formData.get(key) ?? "");
  const tick = (key: string) => formData.get(key) === "on";

  const parsed = settingsSchema.safeParse({
    rulesUrl: text("rulesUrl"),
    privacyUrl: text("privacyUrl"),
    promptUrl: text("promptUrl"),
    rubricUrl: text("rubricUrl"),
    closeTimeConfirmed: tick("closeTimeConfirmed"),
    internalDeadlineConfirmed: tick("internalDeadlineConfirmed"),
    reviewerAccess: text("reviewerAccess"),
    reviewerEmail: text("reviewerEmail"),
    payeeName: text("payeeName"),
    bankName: text("bankName"),
    accountNumber: text("accountNumber"),
    promptPayId: text("promptPayId"),
    paymentQr: formData.get("paymentQrClear") === "1" ? "" : text("paymentQr") || loaded.settings.paymentQr,
    expectedFee: text("expectedFee") || "599",
    refundPolicy: text("refundPolicy"),
    capacity: text("capacity"),
    capacityDecided: tick("capacityDecided"),
    capacityNote: text("capacityNote"),
    guardianConsentText: text("guardianConsentText"),
    finalPromptNote: text("finalPromptNote"),
    aiRulesNote: text("aiRulesNote"),
    // Only the owner hands publishing to admins.
    publishDelegatedToAdmins:
      viewer.tier === "T4_OWNER" ? tick("publishDelegatedToAdmins") : loaded.settings.publishDelegatedToAdmins,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Those settings are not valid." };

  const opensRaw = text("opensAt");
  const closesRaw = text("closesAt");
  const opensAt = opensRaw ? parseBangkokLocal(opensRaw) : null;
  const closesAt = closesRaw ? parseBangkokLocal(closesRaw) : null;
  if (opensRaw && !opensAt) return { error: "The opening time is not a valid date and time." };
  if (closesRaw && !closesAt) return { error: "The closing time is not a valid date and time." };
  if (opensAt && closesAt && closesAt.getTime() <= opensAt.getTime()) {
    return { error: "The closing time has to be after the opening time." };
  }

  if (loaded.workflow.status === "published") {
    const blocking = unresolvedSettings(loaded.workflow.track, parsed.data, { opensAt, closesAt }).filter(
      (i) => i.blocksPublish,
    );
    if (blocking.length > 0) {
      return { error: `This form is published, so these cannot be left empty: ${blocking.map((i) => i.label).join(", ")}.` };
    }
  }

  await db.competitionWorkflow.update({
    where: { id: loaded.workflow.id },
    data: { settings: parsed.data, opensAt, closesAt },
  });
  await audit(viewer.id, "competition.settings.saved", {
    type: "form",
    id: formId,
    detail: `Saved settings for "${loaded.form.title}"`,
  });
  refresh(formId);
  return { ok: "Settings saved." };
}

export async function setCompetitionPublished(formId: string, publish: boolean): Promise<void> {
  const loaded = await loadWorkflow(formId);
  if (!loaded) throw new Error("That form no longer exists.");
  const viewer = await guard("publish", { publishDelegatedToAdmins: loaded.settings.publishDelegatedToAdmins });

  if (publish) {
    const blocking = unresolvedSettings(loaded.workflow.track, loaded.settings, loaded.workflow).filter(
      (i) => i.blocksPublish,
    );
    if (blocking.length > 0) throw new Error(`Still needed before publishing: ${blocking.map((i) => i.label).join(", ")}.`);
  }

  await db.competitionWorkflow.update({
    where: { id: loaded.workflow.id },
    data: { status: publish ? "published" : "draft" },
  });
  await db.form.update({ where: { id: formId }, data: { isOpen: publish } });
  await audit(viewer.id, publish ? "competition.published" : "competition.unpublished", {
    type: "form",
    id: formId,
    detail: `${publish ? "Published" : "Took down"} "${loaded.form.title}"`,
  });
  refresh(formId);
}

/** Stage H, finalist confirmation. The owner's switch, and nobody else's. */
export async function setStageH(formId: string, active: boolean): Promise<void> {
  const viewer = await guard("correct");
  const loaded = await loadWorkflow(formId);
  if (!loaded) throw new Error("That form no longer exists.");
  if (active && loaded.settings.guardianConsentText === "") {
    throw new Error("Add the approved guardian consent text before turning on finalist confirmation.");
  }
  await db.competitionWorkflow.update({ where: { id: loaded.workflow.id }, data: { stageHActive: active } });
  await audit(viewer.id, active ? "competition.stage_h.activated" : "competition.stage_h.deactivated", {
    type: "form",
    id: formId,
    detail: `${active ? "Opened" : "Closed"} finalist confirmation on "${loaded.form.title}"`,
  });
  refresh(formId);
}

// ---------------------------------------------------------------------------
// Editing the wording
// ---------------------------------------------------------------------------

/**
 * Saves edited wording. Only text is taken from the browser: labels, help,
 * section intros, receipts, and a small set of switches. Question ids, types,
 * options, the member repeat, the stop rules and the locked required flags are
 * copied from the stored definition, so an edit can reword a form but can
 * never quietly change what it collects or how it is checked.
 */
export async function saveCompetitionDefinition(_prev: AdminState, formData: FormData): Promise<AdminState> {
  let viewer: Viewer;
  try {
    viewer = await guard("edit");
  } catch (error) {
    return { error: (error as Error).message };
  }
  const formId = String(formData.get("formId") ?? "");
  const loaded = await loadWorkflow(formId);
  if (!loaded) return { error: "That form no longer exists." };

  let edited: unknown;
  try {
    edited = JSON.parse(String(formData.get("definition") ?? ""));
  } catch {
    return { error: "The edits could not be read. Reload and try again." };
  }
  const incoming = parseCompetitionDefinition(edited);
  if (!incoming) return { error: "Something in those edits is too long or empty. Check the highlighted fields." };

  const merged = mergeWording(loaded.definition, incoming);
  const problem = checkCompetitionDefinition(merged);
  if (problem) return { error: problem };
  const valid = parseCompetitionDefinition(merged);
  if (!valid) return { error: "Those edits could not be saved." };

  await db.$transaction([
    db.competitionWorkflow.update({
      where: { id: loaded.workflow.id },
      data: { definition: valid, version: { increment: 1 } },
    }),
    db.form.update({ where: { id: formId }, data: { title: valid.title } }),
  ]);
  await audit(viewer.id, "competition.definition.saved", {
    type: "form",
    id: formId,
    detail: `Edited the wording of "${valid.title}"`,
  });
  refresh(formId);
  return { ok: "Saved. New answers use this version; earlier answers keep the version they were given under." };
}

function mergeQuestion(stored: CQuestion, incoming: CQuestion | undefined): CQuestion {
  if (!incoming) return stored;
  return {
    ...stored,
    label: incoming.label,
    help: incoming.help || undefined,
    confirmLabel: stored.type === "confirm" ? incoming.confirmLabel || stored.confirmLabel : stored.confirmLabel,
    required: stored.locked ? stored.required : incoming.required,
    enabled: stored.type === "document" ? incoming.enabled !== false : stored.enabled,
  };
}

function mergeSection(stored: CSection, incoming: CSection | undefined): CSection {
  const byId = (list: CQuestion[] | undefined) => new Map((list ?? []).map((q) => [q.id, q]));
  const q = byId(incoming?.questions);
  const m = byId(incoming?.memberQuestions);
  const a = byId(incoming?.after);
  return {
    ...stored,
    title: incoming?.title ?? stored.title,
    intro: incoming?.intro || undefined,
    questions: stored.questions.map((x) => mergeQuestion(x, q.get(x.id))),
    memberQuestions: stored.memberQuestions?.map((x) => mergeQuestion(x, m.get(x.id))),
    after: stored.after?.map((x) => mergeQuestion(x, a.get(x.id))),
  };
}

function mergeStage(stored: CStage, incoming: CStage): CStage {
  const sections = new Map(incoming.sections.map((s) => [s.key, s]));
  return {
    ...stored,
    title: incoming.title,
    intro: incoming.intro,
    submitLabel: incoming.submitLabel,
    receipt: incoming.receipt,
    sections: stored.sections.map((s) => mergeSection(s, sections.get(s.key))),
  };
}

function mergeWording(stored: CompetitionDefinition, incoming: CompetitionDefinition): CompetitionDefinition {
  const sections = new Map(incoming.sections.map((s) => [s.key, s]));
  return {
    ...stored,
    title: incoming.title,
    intro: incoming.intro,
    registerLabel: incoming.registerLabel,
    receipt: incoming.receipt,
    sections: stored.sections.map((s) => mergeSection(s, sections.get(s.key))),
    f: mergeStage(stored.f, incoming.f),
    h: mergeStage(stored.h, incoming.h),
  };
}

// ---------------------------------------------------------------------------
// Reviewing teams
// ---------------------------------------------------------------------------

const PAYMENT = ["pending", "verified", "flagged"] as const;
const REGISTRATION = ["registered", "accepted", "rejected", "withdrawn"] as const;

export async function reviewTeam(_prev: AdminState, formData: FormData): Promise<AdminState> {
  let viewer: Viewer;
  try {
    viewer = await guard("review");
  } catch (error) {
    return { error: (error as Error).message };
  }
  const teamId = String(formData.get("teamId") ?? "");
  const team = await db.competitionTeam.findUnique({ where: { id: teamId }, include: { workflow: true } });
  if (!team) return { error: "That team no longer exists." };

  const data: Prisma.CompetitionTeamUpdateInput = {};
  const changes: string[] = [];

  const payment = String(formData.get("paymentStatus") ?? "");
  if (team.track === "external" && (PAYMENT as readonly string[]).includes(payment) && payment !== team.paymentStatus) {
    data.paymentStatus = payment;
    changes.push(`payment ${team.paymentStatus} → ${payment}`);
  }
  const registration = String(formData.get("registrationStatus") ?? "");
  if ((REGISTRATION as readonly string[]).includes(registration) && registration !== team.registrationStatus) {
    data.registrationStatus = registration;
    changes.push(`registration ${team.registrationStatus} → ${registration}`);
  }
  const accessChecked = formData.get("accessChecked") === "on";
  if (accessChecked !== team.accessChecked) {
    data.accessChecked = accessChecked;
    changes.push(`access checked ${accessChecked ? "yes" : "no"}`);
  }
  const notes = String(formData.get("staffNotes") ?? "").trim().slice(0, 5000);
  if (notes !== (team.staffNotes ?? "")) {
    data.staffNotes = notes || null;
    changes.push("staff notes");
  }

  // Choosing finalists is an admin decision, not a head's.
  const finalist = formData.get("finalist") === "on";
  if (finalist !== team.finalist) {
    if (!canCompetition(viewer, "edit")) return { error: "Only admins and the owner select finalists." };
    data.finalist = finalist;
    changes.push(`finalist ${finalist ? "selected" : "removed"}`);
  }

  if (changes.length === 0) return { ok: "Nothing changed." };
  await db.competitionTeam.update({ where: { id: team.id }, data });
  await audit(viewer.id, "competition.team.reviewed", {
    type: "form",
    id: team.workflow.formId,
    detail: `${team.teamCode}: ${changes.join(", ")}`,
  });
  refresh(team.workflow.formId);
  revalidatePath(`/forms/${team.workflow.formId}/teams/${team.id}`);
  return { ok: "Saved." };
}

/** Staff record that they made the organizer copy of a submitted folder. */
export async function recordArchive(_prev: AdminState, formData: FormData): Promise<AdminState> {
  let viewer: Viewer;
  try {
    viewer = await guard("review");
  } catch (error) {
    return { error: (error as Error).message };
  }
  const submissionId = String(formData.get("submissionId") ?? "");
  const note = String(formData.get("archiveNote") ?? "").trim().slice(0, 2000);
  if (note.length < 3) return { error: "Say where the copy is kept, e.g. the organizer Drive folder." };
  const submission = await db.competitionSubmission.findUnique({
    where: { id: submissionId },
    include: { team: { include: { workflow: true } } },
  });
  if (!submission || submission.status !== "final") return { error: "Only a final submission can be archived." };
  await db.competitionSubmission.update({
    where: { id: submission.id },
    data: { archiveStatus: "archived", archivedAt: new Date(), archivedById: viewer.id, archiveNote: note },
  });
  await audit(viewer.id, "competition.submission.archived", {
    type: "form",
    id: submission.team.workflow.formId,
    detail: `${submission.team.teamCode} stage ${submission.stage} archived: ${note}`,
  });
  refresh(submission.team.workflow.formId);
  revalidatePath(`/forms/${submission.team.workflow.formId}/teams/${submission.teamId}`);
  return { ok: "Archive recorded." };
}

/**
 * The audited exception to "final means final". Owner only, with a reason.
 * The locked answers are kept in the entry's history when the team submits
 * again, so nothing is overwritten.
 */
export async function reopenSubmission(_prev: AdminState, formData: FormData): Promise<AdminState> {
  let viewer: Viewer;
  try {
    viewer = await guard("correct");
  } catch (error) {
    return { error: (error as Error).message };
  }
  const submissionId = String(formData.get("submissionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  if (reason.length < 10) return { error: "Write down why this entry is being reopened (at least a sentence)." };
  const submission = await db.competitionSubmission.findUnique({
    where: { id: submissionId },
    include: { team: { include: { workflow: true } } },
  });
  if (!submission || submission.status !== "final") return { error: "Only a final submission can be reopened." };
  await db.competitionSubmission.update({ where: { id: submission.id }, data: { status: "reopened" } });
  await audit(viewer.id, "competition.submission.reopened", {
    type: "form",
    id: submission.team.workflow.formId,
    detail: `${submission.team.teamCode} stage ${submission.stage} (${submission.reference}) reopened: ${reason}`,
  });
  refresh(submission.team.workflow.formId);
  revalidatePath(`/forms/${submission.team.workflow.formId}/teams/${submission.teamId}`);
  return { ok: "Reopened. The team can submit once more through their link." };
}

/**
 * A new private link for a team, shown once to the staff member so they can
 * pass it on. The old link stops working at once.
 */
export async function issueTeamLink(_prev: AdminState, formData: FormData): Promise<AdminState> {
  let viewer: Viewer;
  try {
    viewer = await guard("edit");
  } catch (error) {
    return { error: (error as Error).message };
  }
  const teamId = String(formData.get("teamId") ?? "");
  const team = await db.competitionTeam.findUnique({ where: { id: teamId }, include: { workflow: true } });
  if (!team) return { error: "That team no longer exists." };
  const token = newContinuationToken();
  await db.competitionTeam.update({
    where: { id: team.id },
    data: { continuationHash: hashToken(token), continuationIssuedAt: new Date() },
  });
  await audit(viewer.id, "competition.link.reissued", {
    type: "form",
    id: team.workflow.formId,
    detail: `Staff issued a new team link for ${team.teamCode}`,
  });
  return {
    ok: "New link made. The old one no longer works. Send this to the team's representative only.",
    link: `${await appOrigin()}${continuationPath(team.workflow.formId, token)}`,
  };
}

/** Staff preview: never saves anything. */
export async function previewOnly(): Promise<{ error: string }> {
  return { error: "This is a staff preview. Nothing was saved." };
}
