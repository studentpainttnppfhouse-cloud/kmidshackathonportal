import "server-only";

import type { Assignment, Prisma } from "@prisma/client";
import { canEditPage, isAdmin, type Viewer } from "@/lib/policy";

export function canEditMediaCaptions(viewer: Viewer, socialId: string) {
  return viewer.isActive && !viewer.deletedAt && !viewer.isAlumni && canEditPage(viewer, "assignments") &&
    (isAdmin(viewer) || (viewer.departmentId === socialId &&
      (viewer.tier === "T1_MEMBER" || viewer.tier === "T2_HEAD")));
}

/** Run inside the same transaction as the approval. The source row is locked by its write. */
export async function handOffApprovedGraphics(tx: Prisma.TransactionClient, source: Assignment, actorId: string) {
  if (source.mediaSourceId || source.deletedAt ||
      (source.status !== "APPROVED" && source.status !== "DONE")) return;

  const graphics = await tx.department.findUnique({ where: { id: source.departmentId }, select: { slug: true } });
  if (graphics?.slug !== "graphics") return;

  const social = await tx.department.findUnique({
    where: { slug: "social" },
    select: {
      id: true,
      members: {
        where: { isActive: true, deletedAt: null, isAlumni: false, tier: { in: ["T1_MEMBER", "T2_HEAD"] } },
        select: { id: true },
      },
    },
  });
  if (!social) throw new Error("The Social Media department is missing.");

  await tx.assignment.upsert({
    where: { mediaSourceId: source.id },
    update: {},
    create: {
      title: `Prepare for posting: ${source.title.slice(0, 175)}`,
      departmentId: social.id,
      createdById: actorId,
      mediaSourceId: source.id,
      priority: source.priority,
      year: source.year,
      assignees: { create: social.members.map(({ id }) => ({ userId: id })) },
    },
  });
}
