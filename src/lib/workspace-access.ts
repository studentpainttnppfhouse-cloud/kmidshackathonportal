import "server-only";
import { db } from "./db";
import { can, type Viewer } from "./policy";
import { canReadDrive, canEditDrive, ids } from "./workspace-policy";
import type { DriveItem } from "@prisma/client";
export async function readDrive(v: Viewer, d: DriveItem) {
  if (canReadDrive(v, d)) return true;
  if (d.deletedAt) return false;
  // Explicit submission shares this item with the task's creator, assignees and
  // supervising head/admin, not everyone who can browse the assignment board.
  const links = await db.driveSubmission.findMany({
    where: { itemId: d.id },
    select: { assignmentId: true },
  });
  if (!links.length) return false;
  const tasks = await db.assignment.findMany({
    where: { id: { in: links.map((x) => x.assignmentId) }, deletedAt: null },
    include: { assignees: true },
  });
  return (
    tasks.some((t) =>
      can(v, "update", {
        kind: "assignment",
        departmentId: t.departmentId,
        createdById: t.createdById,
        ownerIds: t.assignees.map((x) => x.userId),
      }),
    ) &&
    can(v, "read", {
      kind: "document",
      departmentId: d.departmentId ?? "",
      ownerId: d.ownerId,
    })
  );
}
export async function driveItems(v: Viewer, mode = "all", q = "") {
  const rows = await db.driveItem.findMany({
    where: {
      deletedAt: null,
      ...(mode === "mine" ? { ownerId: v.id } : {}),
      ...(q ? { title: { contains: q.slice(0, 100) } } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  const result = [];
  for (const row of rows)
    if (
      (mode !== "shared" || row.ownerId !== v.id) &&
      (await readDrive(v, row))
    )
      result.push(row);
  return result;
}
export { canEditDrive, ids };
