import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePageAccess, can } from "@/lib/authorize";
import { FormBuilder } from "@/components/form-builder";
import { PageHeader } from "@/components/ui";
import { canCompetition } from "@/lib/policy";
import { TemplatePicker } from "@/components/competition-manage";

export const metadata: Metadata = { title: "New form" };
export const dynamic = "force-dynamic";

export default async function NewFormPage() {
  // A composer, not a page: a tier held at Read on forms never reaches it.
  const viewer = await requirePageAccess("forms", "edit");

  const departments = await db.department.findMany({ orderBy: { sortOrder: "asc" } });

  const creatable = departments.filter((d) =>
    can(viewer, "create", { kind: "form", departmentId: d.id, ownerId: viewer.id }),
  );
  const portalWide = can(viewer, "create", {
    kind: "form",
    departmentId: null,
    ownerId: viewer.id,
  });

  if (creatable.length === 0 && !portalWide) {
    return (
      <div className="hs-enter space-y-4">
        <PageHeader eyebrow="Forms" title="Only heads and admins build forms" />
        <p className="text-sm text-muted">
          A form collects answers from the whole team, so making one is a head's call. Ask yours.
        </p>
        <Link href="/forms" className="hs-btn hs-btn-secondary">
          Back to forms
        </Link>
      </div>
    );
  }

  return (
    <div className="hs-enter space-y-5">
      <PageHeader
        eyebrow="Forms"
        title="Build a form"
        action={
          <Link href="/forms" className="hs-btn hs-btn-ghost">
            Cancel
          </Link>
        }
      />
      {canCompetition(viewer, "edit") ? <TemplatePicker /> : null}
      <FormBuilder departments={creatable.map((d) => ({ id: d.id, name: d.name }))} />
    </div>
  );
}
