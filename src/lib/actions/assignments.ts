"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan, can, type Resource, type Viewer } from "@/lib/authorize";
import { requireViewer } from "@/lib/authorize";
import { optionalUrlSchema } from "@/lib/url";
import { RULES, rateLimit, retryMessage } from "@/lib/rate-limit";
import { notifyNewAssignment } from "@/lib/teams/notify";
import { canEditMediaCaptions, handOffApprovedGraphics } from "@/lib/media-handoff";
import type { FormState } from "@/lib/actions/auth";
import type { AssignmentStatus, Priority } from "@prisma/client";

const STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "NEEDS_REVIEW",
  "APPROVED",
  "DONE",
] as const satisfies readonly AssignmentStatus[];

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const satisfies readonly Priority[];

const assignmentSchema = z.object({
  title: z.string().trim().min(2, "Give the task a title.").max(200),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  departmentId: z.string().min(1, "Pick a department."),
  dueDate: z.string().optional().or(z.literal("")),
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES),
  linkUrl: optionalUrlSchema,
  recurrence: z.string().trim().max(60).optional().or(z.literal("")),
});

function parseDue(value: string | undefined): Date | null {
  if (!value) return null;
  // <input type="date"> gives YYYY-MM-DD; treat it as end of that day in ICT
  // so "due today" does not go red at midnight UTC, which is 7 AM in Bangkok.
  const d = new Date(`${value}T23:59:59+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function writeLimit(viewer: Viewer): FormState | null {
  const limit = rateLimit(`write:${viewer.id}`, RULES.write);
  return limit.ok ? null : { error: retryMessage(limit.retryAfter) };
}

/**
 * Assignee ids come from checkboxes in a form body, which means they come from
 * whatever the browser felt like posting.
 *
 * TiDB does not enforce foreign keys here (`relationMode = "prisma"`), so an
 * id that belongs to nobody inserts cleanly and produces an assignment row
 * whose `assignees` join returns nothing — work assigned to a ghost. Worse, an
 * id belonging to a deleted or suspended account would quietly put tasks back
 * on somebody who has left. Both are cheap to rule out with one query.
 */
async function validAssigneeIds(ids: string[]): Promise<string[] | null> {
  const unique = [...new Set(ids)].slice(0, 50);
  if (unique.length === 0) return [];

  const found = await db.user.findMany({
    where: { id: { in: unique }, deletedAt: null, isActive: true },
    select: { id: true },
  });

  return found.length === unique.length ? unique : null;
}

async function departmentExists(departmentId: string): Promise<boolean> {
  const found = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true },
  });
  return found !== null;
}

/** Load the resource shape `authorize()` needs to make a decision. */
async function assignmentResource(id: string): Promise<Resource | null> {
  const a = await db.assignment.findUnique({
    where: { id },
    select: {
      departmentId: true,
      createdById: true,
      deletedAt: true,
      assignees: { select: { userId: true } },
    },
  });
  if (!a || a.deletedAt) return null;
  return {
    kind: "assignment",
    departmentId: a.departmentId,
    createdById: a.createdById,
    ownerIds: a.assignees.map((x) => x.userId),
  };
}

export async function createAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const throttled = writeLimit(viewer);
  if (throttled) return throttled;

  const parsed = assignmentSchema.safeParse({
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    departmentId: formData.get("departmentId") ?? "",
    dueDate: formData.get("dueDate") ?? "",
    priority: formData.get("priority") ?? "MEDIUM",
    status: formData.get("status") ?? "NOT_STARTED",
    linkUrl: formData.get("linkUrl") ?? "",
    recurrence: formData.get("recurrence") ?? "",
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const assigneeIds = await validAssigneeIds(
    formData.getAll("assigneeIds").map(String).filter(Boolean),
  );
  if (assigneeIds === null) {
    return { error: "One of the people picked is no longer on the team. Reload and try again." };
  }

  if (!(await departmentExists(d.departmentId))) {
    return { error: "That department no longer exists." };
  }

  assertCan(viewer, "create", {
    kind: "assignment",
    departmentId: d.departmentId,
    createdById: viewer.id,
    ownerIds: assigneeIds,
  });

  // Assigning work to somebody else is a Head/Admin action, not a Member one.
  if (assigneeIds.some((id) => id !== viewer.id)) {
    assertCan(viewer, "assign", {
      kind: "assignment",
      departmentId: d.departmentId,
      createdById: viewer.id,
      ownerIds: assigneeIds,
    });
  }

  // Filing a task as already approved is the same privilege as approving one.
  if (d.status === "APPROVED" || d.status === "DONE") {
    assertCan(viewer, "approve", {
      kind: "assignment",
      departmentId: d.departmentId,
      createdById: viewer.id,
      ownerIds: assigneeIds,
    });
  }

  const created = await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.create({
      data: {
        title: d.title,
        description: d.description || null,
        departmentId: d.departmentId,
        createdById: viewer.id,
        dueDate: parseDue(d.dueDate),
        priority: d.priority,
        status: d.status,
        approvedById: d.status === "APPROVED" || d.status === "DONE" ? viewer.id : null,
        approvedAt: d.status === "APPROVED" || d.status === "DONE" ? new Date() : null,
        linkUrl: d.linkUrl || null,
        recurrence: d.recurrence || null,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      },
    });
    await handOffApprovedGraphics(tx, assignment, viewer.id);
    return assignment;
  });

  await audit(viewer.id, "assignment.created", { type: "assignment", id: created.id, detail: d.title });

  // Told about after it exists. Whether anything is actually sent is the
  // department's ASSIGNMENT_NEW rule's decision, not this action's.
  await notifyNewAssignment({
    assignmentId: created.id,
    title: d.title,
    departmentId: d.departmentId,
    assigneeIds,
    dueDate: created.dueDate,
    priority: d.priority,
    createdById: viewer.id,
    createdByName: viewer.nickname ?? viewer.name,
  });

  revalidatePath("/assignments");
  revalidatePath("/dashboard");
  redirect(`/assignments/${created.id}`);
}

export async function updateAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const throttled = writeLimit(viewer);
  if (throttled) return throttled;

  const id = String(formData.get("id") ?? "");

  const resource = await assignmentResource(id);
  if (!resource) return { error: "That task no longer exists." };

  const parsed = assignmentSchema.safeParse({
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    departmentId: formData.get("departmentId") ?? "",
    dueDate: formData.get("dueDate") ?? "",
    priority: formData.get("priority") ?? "MEDIUM",
    status: formData.get("status") ?? "NOT_STARTED",
    linkUrl: formData.get("linkUrl") ?? "",
    recurrence: formData.get("recurrence") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  assertCan(viewer, "update", resource);

  // Moving a task between departments is a create in the destination, not an
  // edit in the source. Checking only "update" would let anyone who owns a task
  // push it into a department they have no write access to — the form posts
  // departmentId, and the browser decides what that value is.
  if (resource.kind === "assignment" && d.departmentId !== resource.departmentId) {
    if (!(await departmentExists(d.departmentId))) {
      return { error: "That department no longer exists." };
    }
    assertCan(viewer, "create", {
      kind: "assignment",
      departmentId: d.departmentId,
      createdById: viewer.id,
      ownerIds: resource.ownerIds,
    });
  }

  const assigneeIds = await validAssigneeIds(
    formData.getAll("assigneeIds").map(String).filter(Boolean),
  );
  if (assigneeIds === null) {
    return { error: "One of the people picked is no longer on the team. Reload and try again." };
  }

  const current = resource.kind === "assignment" ? resource.ownerIds : [];
  const changed =
    assigneeIds.length !== current.length || assigneeIds.some((x) => !current.includes(x));
  if (changed) assertCan(viewer, "assign", resource);

  // Approving is a distinct permission from editing — a member moving their own
  // task must not be able to mark it approved.
  const approving = d.status === "APPROVED" || d.status === "DONE";
  const wasApproved = await db.assignment.findUnique({
    where: { id },
    select: { status: true, approvedById: true },
  });
  if (approving && wasApproved?.status !== d.status) {
    assertCan(viewer, "approve", resource);
  }

  await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.update({
      where: { id },
      data: {
        title: d.title,
        description: d.description || null,
        departmentId: d.departmentId,
        dueDate: parseDue(d.dueDate),
        priority: d.priority,
        status: d.status,
        linkUrl: d.linkUrl || null,
        recurrence: d.recurrence || null,
        approvedById: approving ? viewer.id : null,
        approvedAt: approving ? new Date() : null,
        ...(changed
          ? { assignees: { deleteMany: {}, create: assigneeIds.map((userId) => ({ userId })) } }
          : {}),
      },
    });
    await handOffApprovedGraphics(tx, assignment, viewer.id);
  });

  await audit(viewer.id, "assignment.updated", { type: "assignment", id });

  revalidatePath("/assignments");
  revalidatePath(`/assignments/${id}`);
  revalidatePath("/dashboard");
  return { ok: "Saved." };
}

/** Board drag-and-drop and the quick status buttons both land here. */
export async function setAssignmentStatus(id: string, status: AssignmentStatus): Promise<void> {
  const viewer = await requireViewer();
  // A server action is a public HTTP endpoint: its arguments are as
  // browser-supplied as any form body, TypeScript types notwithstanding.
  if (!STATUSES.includes(status)) return;

  const resource = await assignmentResource(id);
  if (!resource) return;

  assertCan(viewer, "update", resource);
  if (status === "APPROVED" || status === "DONE") {
    assertCan(viewer, "approve", resource);
  }

  await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.update({
      where: { id },
      data: {
        status,
        approvedById: status === "APPROVED" || status === "DONE" ? viewer.id : null,
        approvedAt: status === "APPROVED" || status === "DONE" ? new Date() : null,
      },
    });
    await handOffApprovedGraphics(tx, assignment, viewer.id);
  });

  await audit(viewer.id, `assignment.status.${status.toLowerCase()}`, {
    type: "assignment",
    id,
  });

  revalidatePath("/assignments");
  revalidatePath(`/assignments/${id}`);
  revalidatePath("/dashboard");
}

export async function saveMediaCaption(id: string, language: "th" | "en", caption: string): Promise<FormState> {
  const viewer = await requireViewer();
  if (typeof id !== "string" || typeof caption !== "string" || caption.length > 10000 ||
      (language !== "th" && language !== "en")) return { error: "Check the caption length." };
  const social = await db.department.findUnique({ where: { slug: "social" }, select: { id: true } });
  if (!social || !canEditMediaCaptions(viewer, social.id)) return { error: "You cannot edit these captions." };

  const handoff = await db.assignment.findFirst({
    where: { id, departmentId: social.id, deletedAt: null },
    select: { mediaSourceId: true },
  });
  if (!handoff?.mediaSourceId) return { error: "This handoff is unavailable." };
  const source = await db.assignment.findFirst({
    where: { id: handoff.mediaSourceId, deletedAt: null, status: { in: ["APPROVED", "DONE"] } },
    select: { id: true },
  });
  if (!source) return { error: "The Graphics assignment needs approval." };

  const changed = await db.assignment.updateMany({
    where: { id, mediaSourceId: source.id, departmentId: social.id, deletedAt: null },
    data: language === "th" ? { captionTh: caption } : { captionEn: caption },
  });
  return changed.count ? { ok: "Saved" } : { error: "This handoff is unavailable." };
}

/** Soft delete only. Students delete things by accident; nothing is ever gone. */
export async function deleteAssignment(id: string): Promise<void> {
  const viewer = await requireViewer();
  const resource = await assignmentResource(id);
  if (!resource) return;

  assertCan(viewer, "delete", resource);

  await db.assignment.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(viewer.id, "assignment.deleted", { type: "assignment", id });

  revalidatePath("/assignments");
  revalidatePath("/dashboard");
}

export async function restoreAssignment(id: string): Promise<void> {
  const viewer = await requireViewer();
  const a = await db.assignment.findUnique({
    where: { id },
    select: { departmentId: true, createdById: true, assignees: { select: { userId: true } } },
  });
  if (!a) return;

  assertCan(viewer, "delete", {
    kind: "assignment",
    departmentId: a.departmentId,
    createdById: a.createdById,
    ownerIds: a.assignees.map((x) => x.userId),
  });

  await db.assignment.update({ where: { id }, data: { deletedAt: null } });
  await audit(viewer.id, "assignment.restored", { type: "assignment", id });
  revalidatePath("/assignments");
}

// ---------------------------------------------------------------------------
// Comments (shared by assignments, documents, incidents)
// ---------------------------------------------------------------------------

/** Is there a thread here at all, and may this viewer read it? */
async function canSeeCommentThread(
  viewer: Viewer,
  parentType: string,
  parentId: string,
): Promise<boolean> {
  if (parentType === "assignment") {
    const found = await db.assignment.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { departmentId: true, createdById: true, assignees: { select: { userId: true } } },
    });
    if (!found) return false;
    return can(viewer, "read", {
      kind: "assignment",
      departmentId: found.departmentId,
      createdById: found.createdById,
      ownerIds: found.assignees.map((a) => a.userId),
    });
  }

  if (parentType === "document") {
    const found = await db.document.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { departmentId: true, ownerId: true },
    });
    if (!found) return false;
    return can(viewer, "read", { kind: "document", ...found });
  }

  if (parentType === "incident") {
    const found = await db.incident.findUnique({ where: { id: parentId }, select: { id: true } });
    if (!found) return false;
    return can(viewer, "read", { kind: "incident" });
  }

  return false;
}

export async function addComment(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  const parentType = String(formData.get("parentType") ?? "");
  const parentId = String(formData.get("parentId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { error: "Write something first." };
  if (body.length > 4000) return { error: "That comment is too long." };
  if (!["assignment", "document", "incident"].includes(parentType)) {
    return { error: "Cannot comment on that." };
  }

  const throttled = writeLimit(viewer);
  if (throttled) return throttled;

  assertCan(viewer, "comment", { kind: "system" });

  // Commenting writes to a thread the viewer must be allowed to see. The
  // incident log is Admin-only, so without this a member could post into it —
  // and, by whether the post succeeded, learn that an incident id exists.
  if (!(await canSeeCommentThread(viewer, parentType, parentId))) {
    return { error: "Cannot comment on that." };
  }

  await db.comment.create({
    data: { parentType, parentId, userId: viewer.id, body },
  });

  await audit(viewer.id, "comment.added", { type: parentType, id: parentId });

  revalidatePath(`/${parentType}s/${parentId}`);
  return { ok: "" };
}

export async function deleteComment(id: string): Promise<void> {
  const viewer = await requireViewer();
  const comment = await db.comment.findUnique({ where: { id } });
  if (!comment) return;

  assertCan(viewer, "delete", { kind: "comment", authorId: comment.userId });

  await db.comment.update({ where: { id }, data: { deletedAt: new Date() } });
  revalidatePath(`/${comment.parentType}s/${comment.parentId}`);
}
