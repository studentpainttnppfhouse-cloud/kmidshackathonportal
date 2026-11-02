import "server-only";
import { db } from "@/lib/db";
import { can, type Viewer } from "@/lib/policy";
import { canRenderInline, isParentType, type ParentType } from "@/lib/attachments";
import { safeHref } from "@/lib/url";

/**
 * Who may read and who may attach, decided from the parent every time.
 *
 * No permission is stored on an attachment row. That is the whole design: a
 * task that moves from Graphics to Marketing takes its files with it, an
 * account demoted from head to member loses the right to attach to the team's
 * work the moment the tier changes, and there is no second copy of the rules to
 * keep in step with `src/lib/policy.ts`.
 *
 * Every branch answers two questions separately. Reading an attachment is
 * reading its parent, which in this portal is broad on purpose — the point of
 * the thing is a shared view. Writing one is *writing* to the parent, which is
 * not: attaching a file to a task is a claim about that task, so it takes the
 * same permission updating the task does. On an assignment that means the
 * person who set it and the people it is set for, which is exactly the pair who
 * need it.
 */

export type ParentAccess = {
  parentType: ParentType;
  parentId: string;
  /** Copied onto new attachments so the files index can filter by team. */
  departmentId: string | null;
  canRead: boolean;
  canWrite: boolean;
  /** Where to revalidate after a change, and where "back" goes. */
  path: string;
  /** For headings and empty states: "this task", "this document". */
  label: string;
};

const DENIED = (parentType: ParentType, parentId: string): ParentAccess => ({
  parentType,
  parentId,
  departmentId: null,
  canRead: false,
  canWrite: false,
  path: "/dashboard",
  label: "this item",
});

/**
 * Resolves a parent, or refuses.
 *
 * Returns a denial rather than throwing for a parent that does not exist, so a
 * caller cannot tell a missing id from a forbidden one — an attachment endpoint
 * that answers "no such task" for some ids and "not allowed" for others is an
 * endpoint that enumerates tasks.
 */
export async function resolveParent(
  viewer: Viewer,
  parentTypeRaw: string,
  parentId: string,
): Promise<ParentAccess> {
  if (!isParentType(parentTypeRaw)) return DENIED("assignment", parentId);
  const parentType = parentTypeRaw;

  if (!parentId || parentId.length > 40) return DENIED(parentType, parentId);

  switch (parentType) {
    case "assignment": {
      const row = await db.assignment.findUnique({
        where: { id: parentId },
        select: {
          departmentId: true,
          createdById: true,
          deletedAt: true,
          assignees: { select: { userId: true } },
        },
      });
      if (!row || row.deletedAt) return DENIED(parentType, parentId);

      const resource = {
        kind: "assignment" as const,
        departmentId: row.departmentId,
        createdById: row.createdById,
        ownerIds: row.assignees.map((a) => a.userId),
      };

      return {
        parentType,
        parentId,
        departmentId: row.departmentId,
        canRead: can(viewer, "read", resource),
        canWrite: can(viewer, "update", resource),
        path: `/assignments/${parentId}`,
        label: "this task",
      };
    }

    case "document": {
      const row = await db.document.findUnique({
        where: { id: parentId },
        select: { departmentId: true, ownerId: true, deletedAt: true },
      });
      if (!row || row.deletedAt) return DENIED(parentType, parentId);

      const resource = {
        kind: "document" as const,
        departmentId: row.departmentId,
        ownerId: row.ownerId,
      };

      return {
        parentType,
        parentId,
        departmentId: row.departmentId,
        canRead: can(viewer, "read", resource),
        canWrite: can(viewer, "update", resource),
        path: `/documents/${parentId}`,
        label: "this document",
      };
    }

    case "announcement": {
      const row = await db.announcement.findUnique({
        where: { id: parentId },
        select: { departmentId: true, authorId: true, deletedAt: true },
      });
      if (!row || row.deletedAt) return DENIED(parentType, parentId);

      const resource = {
        kind: "announcement" as const,
        departmentId: row.departmentId,
        authorId: row.authorId,
      };

      return {
        parentType,
        parentId,
        departmentId: row.departmentId,
        canRead: can(viewer, "read", resource),
        canWrite: can(viewer, "update", resource),
        path: "/announcements",
        label: "this announcement",
      };
    }

    case "file": {
      const row = await db.fileAsset.findUnique({
        where: { id: parentId },
        select: { departmentId: true, uploadedById: true, deletedAt: true },
      });
      if (!row || row.deletedAt) return DENIED(parentType, parentId);

      const resource = {
        kind: "file" as const,
        departmentId: row.departmentId,
        ownerId: row.uploadedById,
      };

      return {
        parentType,
        parentId,
        departmentId: row.departmentId,
        canRead: can(viewer, "read", resource),
        canWrite: can(viewer, "update", resource),
        path: "/files",
        label: "this asset",
      };
    }

    case "form_response": {
      const row = await db.formResponse.findUnique({
        where: { id: parentId },
        select: {
          userId: true,
          form: { select: { id: true, ownerId: true, departmentId: true, isOpen: true } },
        },
      });
      if (!row) return DENIED(parentType, parentId);

      const mine = row.userId !== null && row.userId === viewer.id;
      // A response belongs to whoever wrote it and to whoever runs the form.
      // Nobody else reads it: a form is often the place people say something
      // they would not put in a department channel.
      const runsTheForm = can(viewer, "update", {
        kind: "form",
        departmentId: row.form.departmentId,
        ownerId: row.form.ownerId,
      });

      return {
        parentType,
        parentId,
        departmentId: row.form.departmentId,
        canRead: mine || runsTheForm,
        // Only the person who answered adds files to their own answer, and
        // only while the form is still taking them.
        canWrite: mine && row.form.isOpen,
        path: `/forms/${row.form.id}`,
        label: "this response",
      };
    }

    case "brand_font":
    case "brand_logo": {
      // The brand kit is one shared set. Everyone reads it; admins edit it.
      if (parentId !== "kit") return DENIED(parentType, parentId);
      return {
        parentType,
        parentId,
        departmentId: null,
        canRead: can(viewer, "read", { kind: "system" }),
        canWrite: can(viewer, "manage_departments", { kind: "system" }),
        path: "/brand",
        label: "the brand kit",
      };
    }

    case "user": {
      const row = await db.user.findUnique({
        where: { id: parentId },
        select: { departmentId: true, deletedAt: true },
      });
      if (!row || row.deletedAt) return DENIED(parentType, parentId);

      return {
        parentType,
        parentId,
        departmentId: row.departmentId,
        // Profile photos are shown on every task, comment and people card, so
        // reading one is reading the portal.
        canRead: can(viewer, "read", { kind: "user", userId: parentId }),
        // Yourself, or an admin adding reference files to someone's profile.
        canWrite:
          parentId === viewer.id || can(viewer, "update", { kind: "user", userId: parentId }),
        path: `/people/${parentId}`,
        label: "this profile",
      };
    }
  }
}

/** Everything currently attached to one parent, oldest first. */
export async function listAttachments(parentType: string, parentId: string) {
  if (!isParentType(parentType)) return [];

  return db.attachment.findMany({
    where: { parentType, parentId, deletedAt: null },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      storage: true,
      externalUrl: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true, nickname: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export type AttachmentRow = Awaited<ReturnType<typeof listAttachments>>[number];

/**
 * Attachments for many parents at once, grouped by parent id.
 *
 * The announcements page renders sixty notices, each of which may carry files.
 * Asking per notice is sixty queries for one page; this is one, and the page
 * reads the map.
 */
export async function attachmentsByParent(
  parentType: string,
  parentIds: string[],
): Promise<Map<string, AttachmentRow[]>> {
  const grouped = new Map<string, AttachmentRow[]>();
  if (!isParentType(parentType) || parentIds.length === 0) return grouped;

  const rows = await db.attachment.findMany({
    where: { parentType, parentId: { in: parentIds.slice(0, 200) }, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      name: true,
      mimeType: true,
      size: true,
      storage: true,
      externalUrl: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true, nickname: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  for (const { parentId, ...row } of rows) {
    const existing = grouped.get(parentId);
    if (existing) existing.push(row);
    else grouped.set(parentId, [row]);
  }

  return grouped;
}

/**
 * Attachment counts for a list of parents, in one query.
 *
 * The assignments index shows a paperclip on every task that has files. Asking
 * per row would be sixty queries for one page; `groupBy` is one.
 */
export async function attachmentCounts(
  parentType: string,
  parentIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!isParentType(parentType) || parentIds.length === 0) return counts;

  const rows = await db.attachment.groupBy({
    by: ["parentId"],
    where: { parentType, parentId: { in: parentIds.slice(0, 300) }, deletedAt: null },
    _count: { _all: true },
  });

  for (const row of rows) counts.set(row.parentId, row._count._all);
  return counts;
}

/**
 * Where an asset actually opens.
 *
 * An asset is either a link to Drive or a file the portal holds, and the cards
 * that render them should not each work that out. One query resolves the
 * uploaded ones; anything without an attachment keeps its URL.
 */
export type AssetLink = { href: string; external: boolean; size: number };

export async function assetLinks(
  assets: { id: string; externalUrl: string | null }[],
): Promise<Map<string, AssetLink>> {
  const links = new Map<string, AssetLink>();
  if (assets.length === 0) return links;

  const rows = await db.attachment.findMany({
    where: {
      parentType: "file",
      parentId: { in: assets.map((a) => a.id).slice(0, 300) },
      deletedAt: null,
    },
    select: { id: true, parentId: true, size: true, mimeType: true },
    orderBy: { createdAt: "asc" },
  });

  const uploaded = new Map<string, (typeof rows)[number]>();
  // First attachment wins: an asset carries one file, and a second would be a
  // row written by a code path that does not exist.
  for (const row of rows) if (!uploaded.has(row.parentId)) uploaded.set(row.parentId, row);

  for (const asset of assets) {
    const file = uploaded.get(asset.id);

    if (file) {
      links.set(asset.id, {
        href: `/api/attachments/${file.id}${canRenderInline(file.mimeType) ? "?inline=1" : ""}`,
        external: false,
        size: file.size,
      });
      continue;
    }

    const href = safeHref(asset.externalUrl);
    if (href) links.set(asset.id, { href, external: true, size: 0 });
  }

  return links;
}
