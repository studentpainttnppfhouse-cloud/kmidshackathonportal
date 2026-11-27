import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { CHUNK_BYTES, formatBytes, safeFileName, safeMimeType } from "@/lib/attachments";
import {
  parseCompetitionDefinition,
  parseSettings,
  type CompetitionDefinition,
  type CompetitionSettings,
  type Track,
} from "@/lib/competition/schema";

/**
 * Server-side helpers for the competition forms: loading a workflow, the
 * secret continuation link, opening times and file storage.
 */

export type LoadedWorkflow = {
  form: { id: string; title: string; slug: string | null; ownerId: string; departmentId: string | null };
  workflow: {
    id: string;
    year: number;
    track: Track;
    status: string;
    opensAt: Date | null;
    closesAt: Date | null;
    stageHActive: boolean;
    version: number;
    installKey: string | null;
    templateKey: string;
  };
  definition: CompetitionDefinition;
  settings: CompetitionSettings;
};

/** A competition form by form id or slug, or null for every other kind. */
export async function loadWorkflow(idOrSlug: string): Promise<LoadedWorkflow | null> {
  if (!idOrSlug || idOrSlug.length > 120) return null;
  const form = await db.form.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], deletedAt: null },
    select: { id: true, title: true, slug: true, ownerId: true, departmentId: true },
  });
  if (!form) return null;
  const workflow = await db.competitionWorkflow.findUnique({ where: { formId: form.id } });
  if (!workflow) return null;
  const definition = parseCompetitionDefinition(workflow.definition);
  if (!definition) return null;
  return {
    form,
    workflow: {
      id: workflow.id,
      year: workflow.year,
      track: workflow.track === "external" ? "external" : "internal",
      status: workflow.status,
      opensAt: workflow.opensAt,
      closesAt: workflow.closesAt,
      stageHActive: workflow.stageHActive,
      version: workflow.version,
      installKey: workflow.installKey,
      templateKey: workflow.templateKey,
    },
    definition,
    settings: parseSettings(workflow.settings),
  };
}

export async function isCompetitionForm(formId: string): Promise<boolean> {
  if (!formId) return false;
  const row = await db.competitionWorkflow.findUnique({ where: { formId }, select: { id: true } });
  return row !== null;
}

export type Availability = "draft" | "not_yet_open" | "open" | "closed";

/**
 * Whether the public can answer right now. A draft is never open, and a
 * published form with no times set is treated as not yet open: publishing
 * is refused without them, so this only happens if the data was edited by
 * hand, and failing shut is the right answer then.
 */
export function availability(workflow: LoadedWorkflow["workflow"], now = new Date()): Availability {
  if (workflow.status !== "published") return "draft";
  if (!workflow.opensAt || !workflow.closesAt) return "not_yet_open";
  if (now.getTime() < workflow.opensAt.getTime()) return "not_yet_open";
  if (now.getTime() > workflow.closesAt.getTime()) return "closed";
  return "open";
}

// ---------------------------------------------------------------------------
// The continuation link
// ---------------------------------------------------------------------------

/** 32 random bytes, URL-safe. The only copy is the one handed to the team. */
export function newContinuationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,60}$/.test(token);
}

export async function teamByToken(token: string) {
  if (!looksLikeToken(token)) return null;
  return db.competitionTeam.findUnique({
    where: { continuationHash: hashToken(token) },
    include: { submissions: true },
  });
}

export function continuationPath(formId: string, token: string): string {
  return `/f/${formId}/team/${token}`;
}

/** A short, unguessable submission reference, e.g. R1-INTERNAL01-7KQ2MX. */
export function submissionReference(stage: "F" | "H", code: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let tail = "";
  for (const byte of bytes) tail += alphabet[byte % alphabet.length];
  return `${stage === "F" ? "R1" : "FC"}-${code.toUpperCase()}-${tail}`;
}

// ---------------------------------------------------------------------------
// Times, always Bangkok
// ---------------------------------------------------------------------------

export function bangkokTimestamp(date: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)} (Bangkok time)`;
}

/** "2027-02-14T23:59" typed in a datetime-local box, read as Bangkok time. */
export function parseBangkokLocal(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${withSeconds}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A Date as a Bangkok datetime-local value. */
export function toBangkokLocal(date: Date | null): string {
  if (!date) return "";
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 19);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/**
 * Stores one uploaded file against a team, in the database, the same way every
 * other attachment in the portal is stored (chunks, checksum, sanitised name
 * and type). Nothing touches the host's disk, so a redeploy loses nothing.
 */
export async function storeTeamFile(
  file: File,
  parentType: "competition_team" | "competition_identity",
  teamId: string,
  uploadedById: string,
): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = safeFileName(file.name);
  const attachment = await db.attachment.create({
    data: {
      parentType,
      parentId: teamId,
      name,
      mimeType: safeMimeType(file.type, name),
      size: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      storage: "db",
      departmentId: null,
      uploadedById,
    },
    select: { id: true },
  });
  for (let offset = 0, idx = 0; offset < bytes.byteLength; offset += CHUNK_BYTES, idx += 1) {
    await db.attachmentChunk.create({
      data: {
        attachmentId: attachment.id,
        idx,
        bytes: bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength)),
      },
    });
  }
  await audit(null, "attachment.uploaded", {
    type: parentType,
    id: teamId,
    detail: `Registration file ${name} (${formatBytes(bytes.byteLength)})`,
  });
  return attachment.id;
}

/** Fills in {teamId}, {BangkokTimestamp} and {submissionReference}. */
export function fillReceipt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(teamId|BangkokTimestamp|submissionReference)\}/g, (whole, key: string) =>
    key in values ? values[key] : whole,
  );
}
