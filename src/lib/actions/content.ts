"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, requireViewer, can, type Viewer } from "@/lib/authorize";
import { optionalUrlSchema, urlSchema } from "@/lib/url";
import { RULES, rateLimit, retryMessage } from "@/lib/rate-limit";
import {
  CHUNK_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  formatBytes,
  kindOf,
  safeFileName,
  safeMimeType,
} from "@/lib/attachments";
import type { FormState } from "@/lib/actions/auth";
import type { DocStatus } from "@prisma/client";

const DOC_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
] as const satisfies readonly DocStatus[];

/** Tags arrive as a comma-separated string and live in a JSON column. */
function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * A department id from a form body is a claim, not a fact.
 *
 * `can()` decides whether the viewer may write into department X, but it has no
 * way to know whether X exists — TiDB does not enforce foreign keys under
 * `relationMode = "prisma"`, so an id that matches nothing is inserted
 * perfectly happily and produces a row that every join drops. Checking here
 * turns a silently corrupt record into a form error.
 */
async function assertDepartmentExists(departmentId: string): Promise<boolean> {
  const found = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true },
  });
  return found !== null;
}

/** Guards the write endpoints against a signed-in account being scripted. */
function writeLimit(viewer: Viewer): FormState | null {
  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  return limit.ok ? null : { error: retryMessage(limit.retryAfter) };
}

// ---------------------------------------------------------------------------
// Documents
//
// Two kinds live in one table (decision D3-B, revising D3-A):
//
//   - "external": a link to Google Docs. The original design, kept because
//     comments and version history there already work and nobody wants to
//     re-learn them.
//   - "portal": written in the portal, Markdown body stored in TiDB, exported
//     to .docx / .pdf / .md on demand, and attachable to an assignment so a
//     submission can be the document itself.
// ---------------------------------------------------------------------------

const documentSchema = z.object({
  title: z.string().trim().min(2, "Give the document a title.").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  departmentId: z.string().min(1, "Pick a department."),
  source: z.enum(["external", "portal"]),
  externalUrl: optionalUrlSchema,
  body: z
    .string()
    .max(400_000, "That document is too long to store.")
    .optional()
    .or(z.literal("")),
  assignmentId: z.string().max(40).optional().or(z.literal("")),
  status: z.enum(DOC_STATUSES),
  tags: z.string().trim().max(300).optional().or(z.literal("")),
});

/**
 * Attaching a document to a task is a write to that task's meaning, so it needs
 * the same permission as updating the task — not merely the right to read it.
 */
async function resolveAssignmentLink(
  viewer: Viewer,
  assignmentId: string | undefined,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (!assignmentId) return { ok: true, id: null };

  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      deletedAt: true,
      departmentId: true,
      createdById: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!assignment || assignment.deletedAt) {
    return { ok: false, error: "That task no longer exists." };
  }

  const allowed = can(viewer, "update", {
    kind: "assignment",
    departmentId: assignment.departmentId,
    createdById: assignment.createdById,
    ownerIds: assignment.assignees.map((a) => a.userId),
  });
  if (!allowed) {
    return { ok: false, error: "You cannot attach a document to that task." };
  }

  return { ok: true, id: assignmentId };
}

function readDocumentForm(formData: FormData) {
  return documentSchema.safeParse({
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    departmentId: formData.get("departmentId") ?? "",
    source: "portal",
    externalUrl: formData.get("externalUrl") ?? "",
    body: formData.get("body") ?? "",
    assignmentId: formData.get("assignmentId") ?? "",
    status: formData.get("status") ?? "DRAFT",
    tags: formData.get("tags") ?? "",
  });
}

export async function createDocument(
  _prev: FormState,
  _data: FormData,
): Promise<FormState> {
  redirect("/drive/new");
}
export async function updateDocument(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  redirect(`/drive/${encodeURIComponent(String(data.get("id") ?? ""))}?edit=1`);
}

export async function deleteDocument(id: string): Promise<void> {
  const viewer = await requireViewer();
  const doc = await db.document.findUnique({
    where: { id },
    select: { departmentId: true, ownerId: true },
  });
  if (!doc) return;

  assertCan(viewer, "delete", { kind: "document", ...doc });
  await db.document.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(viewer.id, "document.deleted", { type: "document", id });
  revalidatePath("/documents");
  redirect("/documents");
}

// ---------------------------------------------------------------------------
// Files & assets — an index that now also holds the bytes.
//
// Decision D2-1 made this link-only, on the grounds that Render wipes its disk
// on every deploy and TiDB is not a blob store. The first half of that was
// right and the second half was the wrong conclusion drawn from it: the disk
// was never the only place to put a file. Bytes go in `attachment_chunks`
// (see src/lib/attachments.ts), which survives every redeploy the disk does
// not, and an asset is now either an upload or a link:
//
//   kind = "link"   externalUrl points at Drive or Canva. Unchanged, and still
//                   the right answer for a 400 MB video.
//   anything else   the bytes are an Attachment on this asset, and
//                   externalUrl is null.
//
// The upload path is narrow on purpose: no temp directory, no filesystem, no
// path to traverse, and a stored MIME type that is derived rather than
// believed. What the browser claims a file is has no bearing on how it is
// served back.
// ---------------------------------------------------------------------------

const FILE_KINDS = [
  "link",
  "image",
  "pdf",
  "video",
  "design",
  "font",
  "logo",
  "doc",
] as const;

const fileSchema = z.object({
  name: z.string().trim().min(2, "Name the asset.").max(200),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  externalUrl: urlSchema,
  departmentId: z.string().min(1, "Pick a department."),
  kind: z.enum(FILE_KINDS).optional(),
  tags: z.string().trim().max(300).optional().or(z.literal("")),
  isBrandKit: z.coerce.boolean().optional(),
});

/** The same fields, minus the link, for an asset that carries its own bytes. */
const uploadedFileSchema = fileSchema.omit({ externalUrl: true, kind: true });

export async function createFile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireViewer();
  const throttled = writeLimit(viewer);
  if (throttled) return throttled;

  const parsed = fileSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    externalUrl: formData.get("externalUrl") ?? "",
    departmentId: formData.get("departmentId") ?? "",
    kind: formData.get("kind") || undefined,
    tags: formData.get("tags") ?? "",
    isBrandKit: formData.get("isBrandKit") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (!(await assertDepartmentExists(d.departmentId))) {
    return { error: "That department no longer exists." };
  }

  assertCan(viewer, "create", {
    kind: "file",
    departmentId: d.departmentId,
    ownerId: viewer.id,
  });

  const created = await db.fileAsset.create({
    data: {
      name: d.name,
      description: d.description || null,
      externalUrl: d.externalUrl,
      departmentId: d.departmentId,
      uploadedById: viewer.id,
      kind: d.kind ?? "link",
      tags: parseTags(d.tags),
      isBrandKit: Boolean(d.isBrandKit),
    },
  });

  await audit(viewer.id, "file.created", {
    type: "file",
    id: created.id,
    detail: d.name,
  });
  revalidatePath("/files");
  revalidatePath("/brand");
  redirect("/files");
}

/**
 * Files an asset by uploading it, rather than by pointing at it.
 *
 * The whole flow is one submission: the asset row and its bytes are written
 * together, so there is no window in which the index lists an asset that has
 * nothing behind it. If the bytes fail, the row does not exist, and the person
 * is told which file was the problem rather than finding an empty card later.
 *
 * Over the limit, the form falls back to the link path above. That is not a
 * consolation prize — for a 400 MB export video it is the correct answer, and
 * the portal keeps the name, the team and the tags either way.
 */
export async function uploadFileAsset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireViewer();
  const throttled = writeLimit(viewer);
  if (throttled) return throttled;

  const parsed = uploadedFileSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    departmentId: formData.get("departmentId") ?? "",
    tags: formData.get("tags") ?? "",
    isBrandKit: formData.get("isBrandKit") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const upload = formData.get("file");
  if (!(upload instanceof File) || upload.size === 0) {
    return { error: "Pick a file to upload, or paste a link instead." };
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return {
      error: `That file is ${formatBytes(upload.size)}, over the ${MAX_UPLOAD_LABEL} limit. Put it in Drive and paste the link instead.`,
    };
  }

  if (!(await assertDepartmentExists(d.departmentId))) {
    return { error: "That department no longer exists." };
  }

  assertCan(viewer, "create", {
    kind: "file",
    departmentId: d.departmentId,
    ownerId: viewer.id,
  });

  const fileName = safeFileName(upload.name);
  const mimeType = safeMimeType(upload.type, fileName);
  const bytes = Buffer.from(await upload.arrayBuffer());

  // Re-measured from what actually arrived, not from the size the browser
  // reported before sending it.
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { error: "That file did not arrive in one piece. Try it again." };
  }

  const asset = await db.fileAsset.create({
    data: {
      name: d.name,
      description: d.description || null,
      externalUrl: null,
      departmentId: d.departmentId,
      uploadedById: viewer.id,
      kind: kindOf(mimeType),
      tags: parseTags(d.tags),
      isBrandKit: Boolean(d.isBrandKit),
    },
  });

  const attachment = await db.attachment.create({
    data: {
      parentType: "file",
      parentId: asset.id,
      name: fileName,
      mimeType,
      size: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      storage: "db",
      departmentId: d.departmentId,
      uploadedById: viewer.id,
    },
  });

  for (
    let offset = 0, idx = 0;
    offset < bytes.byteLength;
    offset += CHUNK_BYTES, idx += 1
  ) {
    await db.attachmentChunk.create({
      data: {
        attachmentId: attachment.id,
        idx,
        bytes: bytes.subarray(
          offset,
          Math.min(offset + CHUNK_BYTES, bytes.byteLength),
        ),
      },
    });
  }

  await audit(viewer.id, "file.uploaded", {
    type: "file",
    id: asset.id,
    detail: `${d.name} (${formatBytes(bytes.byteLength)})`,
  });

  revalidatePath("/files");
  revalidatePath("/brand");
  redirect("/files");
}

export async function deleteFile(id: string): Promise<void> {
  const viewer = await requireViewer();
  const f = await db.fileAsset.findUnique({
    where: { id },
    select: { departmentId: true, uploadedById: true },
  });
  if (!f) return;

  assertCan(viewer, "delete", {
    kind: "file",
    departmentId: f.departmentId,
    ownerId: f.uploadedById,
  });

  await db.fileAsset.update({ where: { id }, data: { deletedAt: new Date() } });

  // The row is soft-deleted like everything else, so the recycle bin can
  // restore the card. The bytes are not: an uploaded asset is stored in the
  // database, and keeping deleted files around is a bill nobody agreed to.
  // A restored upload comes back as a card that says what it was.
  const uploads = await db.attachment.findMany({
    where: { parentType: "file", parentId: id, deletedAt: null },
    select: { id: true },
  });
  if (uploads.length > 0) {
    const ids = uploads.map((upload) => upload.id);
    await db.attachment.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });
    await db.attachmentChunk.deleteMany({
      where: { attachmentId: { in: ids } },
    });
  }

  await audit(viewer.id, "file.deleted", { type: "file", id });
  revalidatePath("/files");
  revalidatePath("/brand");
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

const announcementSchema = z.object({
  title: z.string().trim().min(2, "Give the announcement a title.").max(200),
  body: z.string().trim().min(2, "Write the announcement.").max(5000),
  scope: z.enum(["all", "department"]),
  departmentId: z.string().optional().or(z.literal("")),
  pinned: z.coerce.boolean().optional(),
  toTeams: z.coerce.boolean().optional(),
});

export async function createAnnouncement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireViewer();
  const throttled = writeLimit(viewer);
  if (throttled) return throttled;

  const parsed = announcementSchema.safeParse({
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
    scope: formData.get("scope") ?? "department",
    departmentId: formData.get("departmentId") ?? "",
    pinned: formData.get("pinned") === "on",
    toTeams: formData.get("toTeams") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const departmentId = d.scope === "all" ? null : d.departmentId || null;
  if (d.scope === "department" && !departmentId) {
    return { error: "Pick which department this is for." };
  }
  if (departmentId && !(await assertDepartmentExists(departmentId))) {
    return { error: "That department no longer exists." };
  }

  // All-staff announcements are an Admin action; a head announces to their own
  // department only. `can()` encodes both — this call is the whole check.
  assertCan(viewer, "create", {
    kind: "announcement",
    departmentId,
    authorId: viewer.id,
  });

  const created = await db.announcement.create({
    data: {
      title: d.title,
      body: d.body,
      scope: d.scope,
      departmentId,
      authorId: viewer.id,
      pinned: Boolean(d.pinned),
    },
  });

  await audit(viewer.id, "announcement.created", {
    type: "announcement",
    id: created.id,
  });

  revalidatePath("/announcements");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  redirect("/announcements");
}

export async function updateAnnouncement(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireViewer();
  const throttled = writeLimit(viewer);
  if (throttled) return throttled;

  const existing = await db.announcement.findUnique({
    where: { id },
    select: { departmentId: true, authorId: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt)
    return { error: "That announcement no longer exists." };
  if (!can(viewer, "update", { kind: "announcement", ...existing })) {
    await audit(viewer.id, "announcement.update_denied", {
      type: "announcement",
      id,
      detail:
        "Tried to edit an announcement they may not edit. Reason: only the author, the department head or an admin can edit it.",
    });
    return { error: "You can't edit this announcement." };
  }

  const parsed = z
    .object({
      title: z
        .string()
        .trim()
        .min(2, "Give the announcement a title.")
        .max(200),
      body: z.string().trim().min(2, "Write the announcement.").max(5000),
      pinned: z.boolean(),
    })
    .safeParse({
      title: formData.get("title") ?? "",
      body: formData.get("body") ?? "",
      pinned: formData.get("pinned") === "on",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await db.announcement.update({ where: { id }, data: parsed.data });
  await audit(viewer.id, "announcement.updated", {
    type: "announcement",
    id,
    detail: "Edited the announcement title or text",
  });

  revalidatePath("/announcements");
  revalidatePath("/dashboard");
  redirect(`/announcements/${id}`);
}

export async function markAnnouncementRead(id: string): Promise<void> {
  const viewer = await requireViewer();

  // "Read" is written against an id from the page, so the id gets checked
  // rather than trusted: an announcement scoped to another department is not
  // something this account may mark, or even confirm the existence of.
  const announcement = await db.announcement.findUnique({
    where: { id },
    select: { departmentId: true, deletedAt: true, authorId: true },
  });
  if (!announcement || announcement.deletedAt) return;
  if (
    !can(viewer, "read", {
      kind: "announcement",
      departmentId: announcement.departmentId,
      authorId: announcement.authorId,
    })
  ) {
    return;
  }

  await db.announcementRead.upsert({
    where: { announcementId_userId: { announcementId: id, userId: viewer.id } },
    create: { announcementId: id, userId: viewer.id },
    update: {},
  });
  revalidatePath("/announcements");
  revalidatePath("/dashboard");
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const viewer = await requireViewer();
  const n = await db.announcement.findUnique({
    where: { id },
    select: { departmentId: true, authorId: true },
  });
  if (!n) return;

  assertCan(viewer, "delete", { kind: "announcement", ...n });
  await db.announcement.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await audit(viewer.id, "announcement.deleted", { type: "announcement", id });
  revalidatePath("/announcements");
}

// ---------------------------------------------------------------------------
// Forms — external links plus forms built and answered inside the portal.
// The question schema and the responses live in src/lib/actions/forms.ts.
// ---------------------------------------------------------------------------

export async function deleteForm(id: string): Promise<void> {
  const viewer = await requireViewer();
  const f = await db.form.findUnique({
    where: { id },
    select: { departmentId: true, ownerId: true },
  });
  if (!f) return;

  assertCan(viewer, "delete", { kind: "form", ...f });
  await db.form.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(viewer.id, "form.deleted", { type: "form", id });
  revalidatePath("/forms");
}
