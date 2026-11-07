"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireViewer } from "@/lib/authorize";
import { resolveParent } from "@/lib/attachment-access";
import {
  CHUNK_BYTES,
  MAX_FILES_PER_UPLOAD,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  formatBytes,
  safeFileName,
  safeMimeType,
} from "@/lib/attachments";
import { RULES, rateLimit, retryMessage } from "@/lib/rate-limit";
import { urlSchema } from "@/lib/url";
import type { FormState } from "@/lib/actions/auth";

/**
 * Uploading, as the portal does it.
 *
 * The bytes arrive in a Server Action rather than a route handler on purpose.
 * A Server Action already carries the session cookie, already has its Origin
 * checked by the framework, and already runs the same `requireViewer()` every
 * other write in this codebase runs — so there is no new authentication path
 * and no new CSRF surface. `next.config.ts` raises the body limit to match
 * MAX_UPLOAD_BYTES; anything over it never reaches this function.
 *
 * Files are written the moment they are chosen, not when the surrounding form
 * is submitted. That is the difference between "I attached it" and "I attached
 * it and then the browser died before I pressed save", and on a phone on school
 * Wi-Fi the second one happens.
 */

export type UploadState = FormState & { uploaded?: number };

/** Adds one or more files to a parent, storing the bytes in the database. */
export async function uploadAttachments(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const viewer = await requireViewer();

  const limit = rateLimit(`upload:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  const parent = await resolveParent(
    viewer,
    String(formData.get("parentType") ?? ""),
    String(formData.get("parentId") ?? ""),
  );
  if (!parent.canWrite) return { error: "You cannot attach files here." };

  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) return { error: "Pick a file first." };
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return { error: `Attach at most ${MAX_FILES_PER_UPLOAD} files at a time.` };
  }

  // Checked here as well as in the browser and in the body limit, because the
  // browser check is a courtesy and the body limit is a blunt instrument that
  // cannot say which file was the problem.
  const tooBig = files.find((file) => file.size > MAX_UPLOAD_BYTES);
  if (tooBig) {
    return {
      error: `"${safeFileName(tooBig.name)}" is ${formatBytes(tooBig.size)}. Anything over ${MAX_UPLOAD_LABEL} has to go in as a link — there is a box for it below.`,
    };
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_UPLOAD_BYTES) {
    return {
      error: `That is ${formatBytes(total)} at once. Send them in batches of ${MAX_UPLOAD_LABEL} or less.`,
    };
  }

  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());

    // The size is re-read from the bytes actually received rather than trusted
    // from `File.size`, which is a number the client reported.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
      return { error: `"${safeFileName(file.name)}" did not arrive in one piece. Try it again.` };
    }

    const name = safeFileName(file.name);
    const attachment = await db.attachment.create({
      data: {
        parentType: parent.parentType,
        parentId: parent.parentId,
        name,
        mimeType: safeMimeType(file.type, name),
        size: bytes.byteLength,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        storage: "db",
        departmentId: parent.departmentId,
        uploadedById: viewer.id,
      },
    });

    // One row per chunk, written in order. A batch insert would put the whole
    // file in one transaction entry, which is the size TiDB caps.
    for (let offset = 0, idx = 0; offset < bytes.byteLength; offset += CHUNK_BYTES, idx += 1) {
      await db.attachmentChunk.create({
        data: {
          attachmentId: attachment.id,
          idx,
          bytes: bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength)),
        },
      });
    }

    await audit(viewer.id, "attachment.uploaded", {
      type: parent.parentType,
      id: parent.parentId,
      detail: `${name} (${formatBytes(bytes.byteLength)})`,
    });
  }

  revalidatePath(parent.path);
  return {
    ok: `${files.length} ${files.length === 1 ? "file" : "files"} saved.`,
    uploaded: files.length,
  };
}

/**
 * Records a file too big to store, as a link.
 *
 * The size limit is a real constraint, not a preference, and a 400 MB export
 * video was never going to live in a serverless MySQL row. Rather than refuse
 * and leave the person with nowhere to put it, the attachment list takes the
 * name and the URL, so the task still says what exists and where it is.
 */
export async function linkAttachment(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireViewer();

  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };

  const parent = await resolveParent(
    viewer,
    String(formData.get("parentType") ?? ""),
    String(formData.get("parentId") ?? ""),
  );
  if (parent.parentType === "drive") return {error:"Portal drive stores uploaded files, not external links."};
  if (!parent.canWrite) return { error: "You cannot attach files here." };

  const name = safeFileName(String(formData.get("name") ?? "").trim());
  if (name === "file") return { error: "Give the file a name so people know what it is." };

  // The same scheme allowlist every other link in the portal goes through:
  // http and https only, so an attachment row can never become a javascript:
  // href sitting in a task everybody clicks.
  const url = urlSchema.safeParse(formData.get("externalUrl") ?? "");
  if (!url.success) return { error: url.error.issues[0].message };

  await db.attachment.create({
    data: {
      parentType: parent.parentType,
      parentId: parent.parentId,
      name,
      mimeType: "application/octet-stream",
      size: 0,
      storage: "link",
      externalUrl: url.data,
      departmentId: parent.departmentId,
      uploadedById: viewer.id,
    },
  });

  await audit(viewer.id, "attachment.linked", {
    type: parent.parentType,
    id: parent.parentId,
    detail: name,
  });

  revalidatePath(parent.path);
  return { ok: `"${name}" added.` };
}

/**
 * Removes an attachment.
 *
 * Soft-deleted like everything else in the portal, and the chunks go with it:
 * a recycle bin for a document is a paragraph somebody can retype, but a
 * recycle bin for files is a database bill nobody agreed to. The row survives
 * so the audit trail still shows what was there and who removed it.
 */
export async function deleteAttachment(id: string): Promise<void> {
  const viewer = await requireViewer();

  const attachment = await db.attachment.findUnique({
    where: { id },
    select: {
      parentType: true,
      parentId: true,
      uploadedById: true,
      name: true,
      deletedAt: true,
    },
  });
  if (!attachment || attachment.deletedAt) return;

  const parent = await resolveParent(viewer, attachment.parentType, attachment.parentId);
  // Whoever attached it may take it back; otherwise it takes write access to
  // the parent, which is the same rule the rest of the portal uses for
  // somebody else's work.
  const mine = attachment.uploadedById === viewer.id;
  if (!mine && !parent.canWrite) return;

  await db.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
  await db.attachmentChunk.deleteMany({ where: { attachmentId: id } });

  await audit(viewer.id, "attachment.deleted", {
    type: attachment.parentType,
    id: attachment.parentId,
    detail: attachment.name,
  });

  revalidatePath(parent.path);
}
