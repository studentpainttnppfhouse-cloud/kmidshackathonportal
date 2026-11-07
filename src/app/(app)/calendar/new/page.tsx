import { requirePageAccess } from "@/lib/authorize";
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
  const [people, departments] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
    }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Workspace" title="New event" />
      <EntryForm
        entry={{ date: sp.date ?? bangkokDay(new Date()), kind: sp.kind }}
        level={TIER_ORDER[v.tier]}
        ownDepartment={v.departmentId}
        people={people
          .filter((p) => canAssignPerson(v, p))
          .map((p) => ({ id: p.id, name: p.nickname || p.name }))}
        departments={departments.filter(
          (d) => TIER_ORDER[v.tier] >= 3 || d.id === v.departmentId,
        )}
      />
    </div>
  );
}
