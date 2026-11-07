import { requirePageAccess } from "@/lib/authorize";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { DriveForm } from "@/components/workspace-forms";
export default async function NewDrive() {
  const v = await requirePageAccess("documents", "edit");
  const [people, departments] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.department.findMany({
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Workspace" title="New document or file collection" />
      <DriveForm
        people={people.filter((p) => p.id !== v.id)}
        departments={departments}
      />
    </div>
  );
}
