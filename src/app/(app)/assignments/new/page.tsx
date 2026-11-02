import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePageAccess, isAdmin, can } from "@/lib/authorize";
import { AssignmentForm } from "@/components/assignment-form";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "New task" };
export const dynamic = "force-dynamic";

/**
 * Filing a task is its own page.
 *
 * It used to be a card at the foot of the board — which meant the form was
 * below however many hundred cards the board happened to hold, and opening it
 * reflowed everything above. A page reached from a button at the top costs one
 * navigation and always looks the same.
 */
export default async function NewAssignmentPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  // A composer, not a page: a tier held at Read on assignments never reaches it.
  const viewer = await requirePageAccess("assignments", "edit");
  const { dept } = await searchParams;

  const [departments, people] = await Promise.all([
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
    db.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        name: true,
        nickname: true,
        avatarUrl: true,
        departmentId: true,
        roleTitle: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const creatable = departments.filter((d) =>
    can(viewer, "create", {
      kind: "assignment",
      departmentId: d.id,
      createdById: viewer.id,
      ownerIds: [viewer.id],
    }),
  );

  if (creatable.length === 0) {
    return (
      <div className="hs-enter space-y-4">
        <PageHeader eyebrow="Assignments" title="You cannot file tasks yet" />
        <p className="text-sm text-muted">
          Tasks belong to a department. Ask an admin to put your account in one, and this page
          starts working.
        </p>
        <Link href="/assignments" className="hs-btn hs-btn-secondary">
          Back to the board
        </Link>
      </div>
    );
  }

  const canAssignOthers =
    isAdmin(viewer) ||
    departments.some((d) =>
      can(viewer, "assign", {
        kind: "assignment",
        departmentId: d.id,
        createdById: viewer.id,
        ownerIds: [],
      }),
    );

  const preselect = creatable.find((d) => d.slug === dept)?.id;

  return (
    <div className="hs-enter space-y-5">
      <PageHeader
        eyebrow="Assignments"
        title="New task"
        subtitle="What needs doing, who owns it, and when it is due."
        action={
          <Link href="/assignments" className="hs-btn hs-btn-ghost">
            Cancel
          </Link>
        }
      />

      <div className="hs-card p-5 sm:p-6">
        <AssignmentForm
          departments={creatable.map((d) => ({ id: d.id, name: d.name }))}
          people={
            canAssignOthers
              ? people
              : people.filter((p) => p.id === viewer.id)
          }
          canAssignOthers={canAssignOthers}
          canApprove={canAssignOthers}
          viewerId={viewer.id}
          teams={departments.map((d) => ({ id: d.id, name: d.name }))}
          defaultDepartmentId={preselect}
          defaultAssigneeIds={canAssignOthers ? [] : [viewer.id]}
        />
      </div>
    </div>
  );
}
