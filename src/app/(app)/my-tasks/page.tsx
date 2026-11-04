import Link from "next/link";
import type { Metadata } from "next";
import { requireViewer } from "@/lib/authorize";
import { PageHeader } from "@/components/ui";
import { AssignmentFilters } from "@/components/assignment-filters";
import { ListView } from "../assignments/views";
import { loadTasks } from "../assignments/query";

export const metadata: Metadata = { title: "My assignments" };
export const dynamic = "force-dynamic";

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; status?: string }>;
}) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const { tasks, departments, creatable } = await loadTasks(viewer, { ...sp, mine: true });

  return (
    <div className="hs-enter space-y-4">
      <PageHeader
        eyebrow="Tasks"
        title="My assignments"
        action={
          creatable.length > 0 ? (
            <Link href="/assignments/new" className="hs-btn hs-btn-primary">
              <span aria-hidden="true">＋</span> New task
            </Link>
          ) : null
        }
      />
      <AssignmentFilters departments={departments} dept={sp.dept} status={sp.status} />
      <ListView items={tasks} />
    </div>
  );
}
