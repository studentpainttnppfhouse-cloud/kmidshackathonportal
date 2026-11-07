import { requirePageAccess, atLeast } from "@/lib/authorize";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { EntryForm } from "@/components/workspace-forms";
import { PageHeader } from "@/components/ui";
import { canAssignPerson, bangkokDay } from "@/lib/workspace-policy";
import { TIER_ORDER } from "@/lib/constants";
export default async function NewEvent({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; kind?: string }>;
}) {
  const v = await requirePageAccess("calendar", "edit");
  const sp = await searchParams;
  const meeting = sp.kind === "meeting";
  if (meeting && (!v.isActive || v.isAlumni || !atLeast(v, "T2_HEAD")))
    redirect("/meetings");
  const [people, departments] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
    }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Workspace"
        title={meeting ? "New meeting" : "New event"}
      />
      <EntryForm
        entry={{
          date: sp.date ?? bangkokDay(new Date()),
          kind: sp.kind,
          scope: meeting ? "all" : undefined,
        }}
        level={TIER_ORDER[v.tier]}
        ownDepartment={v.departmentId}
        people={people
          .filter((p) => meeting || canAssignPerson(v, p))
          .map((p) => ({
            id: p.id,
            name: p.nickname ? `${p.nickname} · ${p.name}` : p.name,
            departmentId: p.departmentId,
          }))}
        departments={departments.filter(
          (d) => meeting || TIER_ORDER[v.tier] >= 3 || d.id === v.departmentId,
        )}
      />
    </div>
  );
}
