import "server-only";
import { db } from "@/lib/db";
import { can, type Viewer } from "@/lib/authorize";
import { STATUS_ORDER } from "@/lib/constants";
import type { AssignmentSummary } from "@/components/assignment-row";
import type { AssignmentStatus, Prisma } from "@prisma/client";

const include = {
  department: { select: { name: true, color: true, slug: true } },
  assignees: {
    select: { user: { select: { id: true, name: true, nickname: true, avatarUrl: true } } },
  },
} as const;

/** `all` lifts the row cap, for the Owner and Admins who oversee every team. */
export type TaskFilters = { dept?: string; status?: string; mine?: boolean; all?: boolean };

/** Tasks the viewer may read, filtered the same way on every task page. */
export async function loadTasks(viewer: Viewer, f: TaskFilters) {
  const where: Prisma.AssignmentWhereInput = { deletedAt: null };
  if (f.mine) where.assignees = { some: { userId: viewer.id } };
  if (f.dept) where.department = { slug: f.dept };
  if (f.status === "overdue") {
    where.dueDate = { lt: new Date() };
    where.status = { notIn: ["DONE", "APPROVED"] };
  } else if (f.status && (STATUS_ORDER as readonly string[]).includes(f.status)) {
    where.status = f.status as AssignmentStatus;
  }

  const [items, departments] = await Promise.all([
    db.assignment.findMany({
      where,
      include,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: f.all ? 5000 : 400,
    }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  // Filter through the policy rather than trusting the query: `can()` is the
  // single place the rules live.
  const tasks = items.filter((a) =>
    can(viewer, "read", {
      kind: "assignment",
      departmentId: a.departmentId,
      createdById: a.createdById,
      ownerIds: a.assignees.map((x) => x.user.id),
    }),
  ) as AssignmentSummary[];

  const creatable = departments.filter((d) =>
    can(viewer, "create", {
      kind: "assignment",
      departmentId: d.id,
      createdById: viewer.id,
      ownerIds: [viewer.id],
    }),
  );

  return { tasks, departments, creatable };
}
