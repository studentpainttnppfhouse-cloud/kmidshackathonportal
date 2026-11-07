import Link from "next/link";
import { requirePageAccess, canEditPage, atLeast } from "@/lib/authorize";
import { driveItems } from "@/lib/workspace-access";
import { ids } from "@/lib/workspace-policy";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { DriveLibrary } from "@/components/drive-library";
export const dynamic = "force-dynamic";

export default async function Drive({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const viewer = await requirePageAccess("documents");
  const params = await searchParams;
  const items = await driveItems(viewer);
  const [creators, departments, visits] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...new Set(items.map((item) => item.ownerId))] } },
      select: { id: true, name: true, nickname: true },
    }),
    db.department.findMany({ select: { id: true, name: true } }),
    db.driveVisit.findMany({
      where: {
        userId: viewer.id,
        itemId: { in: items.map((item) => item.id) },
      },
      select: { itemId: true, openedAt: true },
    }),
  ]);
  const names = new Map(
    creators.map((person) => [person.id, person.nickname || person.name]),
  );
  const teams = new Map(departments.map((team) => [team.id, team.name]));
  const opened = new Map(
    visits.map((visit) => [visit.itemId, visit.openedAt.toISOString()]),
  );
  return (
    <div className="hs-enter space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Documents"
        subtitle="Your work, ready to write, find and share."
        action={
          viewer.isActive &&
          canEditPage(viewer, "documents") &&
          atLeast(viewer, "T1_MEMBER") &&
          !viewer.isAlumni ? (
            <Link href="/drive/new" className="hs-btn hs-btn-primary">
              + New document
            </Link>
          ) : null
        }
      />
      <DriveLibrary
        viewerId={viewer.id}
        initialFilter={
          ["all", "mine", "shared"].includes(params.view ?? "")
            ? params.view
            : "all"
        }
        initialQuery={params.q}
        items={items.map((item) => ({
          id: item.id,
          title: item.title,
          preview: (item.body ?? "").slice(0, 3000),
          kind: item.kind,
          ownerId: item.ownerId,
          ownerName: names.get(item.ownerId) ?? "Former staff member",
          updatedAt: item.updatedAt.toISOString(),
          createdAt: item.createdAt.toISOString(),
          openedAt: opened.get(item.id) ?? null,
          sharing:
            item.scope === "private"
              ? "Private"
              : item.scope === "all"
                ? "Everyone in the portal"
                : item.scope === "department"
                  ? (teams.get(item.departmentId ?? "") ?? "Department")
                  : [
                      ...ids(item.sharedDepartmentIds).map(
                        (id) => teams.get(id) ?? "Team",
                      ),
                      ...(ids(item.sharedUserIds).length
                        ? [`${ids(item.sharedUserIds).length} people`]
                        : []),
                    ].join(" · "),
        }))}
      />
    </div>
  );
}
