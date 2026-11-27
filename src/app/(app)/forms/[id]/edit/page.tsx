import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePageAccess, can } from "@/lib/authorize";
import { FormBuilder } from "@/components/form-builder";
import { PageHeader } from "@/components/ui";
import { parseDefinition } from "@/lib/forms-schema";
import { loadWorkflow } from "@/lib/competition/server";
import { canCompetition } from "@/lib/policy";
import { DefinitionEditor } from "@/components/competition-admin-forms";

export const metadata: Metadata = { title: "Edit form" };
export const dynamic = "force-dynamic";

export default async function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  // A composer, not a page: a tier held at Read on forms never reaches it.
  const viewer = await requirePageAccess("forms", "edit");
  const { id } = await params;

  const competition = await loadWorkflow(id);
  if (competition) {
    if (!canCompetition(viewer, "edit")) notFound();
    return (
      <div className="hs-enter space-y-5">
        <PageHeader
          eyebrow="Competition form"
          title="Edit wording"
          action={
            <Link href={`/forms/${id}`} className="hs-btn hs-btn-ghost">
              Back
            </Link>
          }
        />
        <p className="text-sm text-muted">
          Change any question text, help line, intro or receipt. Question IDs, answer options, the member repeat and
          the eligibility stops are fixed, so answers stay comparable across versions.
        </p>
        <DefinitionEditor formId={competition.form.id} definition={competition.definition} />
      </div>
    );
  }

  const form = await db.form.findUnique({ where: { id } });
  if (!form || form.deletedAt || form.type !== "internal") notFound();

  if (!can(viewer, "update", { kind: "form", departmentId: form.departmentId, ownerId: form.ownerId })) {
    notFound();
  }

  const departments = await db.department.findMany({ orderBy: { sortOrder: "asc" } });
  const selectable = departments.filter(
    (d) =>
      d.id === form.departmentId ||
      can(viewer, "create", { kind: "form", departmentId: d.id, ownerId: viewer.id }),
  );

  return (
    <div className="hs-enter space-y-5">
      <PageHeader
        eyebrow="Forms"
        title="Edit form"
        action={
          <Link href={`/forms/${form.id}`} className="hs-btn hs-btn-ghost">
            Cancel
          </Link>
        }
      />
      <FormBuilder
        departments={selectable.map((d) => ({ id: d.id, name: d.name }))}
        form={{
          id: form.id,
          title: form.title,
          description: form.description,
          departmentId: form.departmentId,
          deadline: form.deadline,
          isOpen: form.isOpen,
          definition: parseDefinition(form.schema),
        }}
      />
    </div>
  );
}
