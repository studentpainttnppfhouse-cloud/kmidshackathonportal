import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireViewer, can } from "@/lib/authorize";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateLong } from "@/lib/dates";
import { canCompetition } from "@/lib/policy";
import { installCompetitionDrafts } from "@/lib/actions/competition-admin";

export const metadata: Metadata = { title: "Forms" };
export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const viewer = await requireViewer();

  const [forms, departments, workflows] = await Promise.all([
    db.form.findMany({
      where: { deletedAt: null },
      include: {
        owner: { select: { name: true, nickname: true } },
        department: { select: { name: true, color: true } },
        _count: { select: { responses: true } },
      },
      orderBy: [{ isOpen: "desc" }, { deadline: "asc" }],
    }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
    db.competitionWorkflow.findMany({
      select: { formId: true, track: true, status: true, installKey: true, _count: { select: { teams: true } } },
    }),
  ]);
  const competitionByForm = new Map(workflows.map((w) => [w.formId, w]));
  const seesCompetition = canCompetition(viewer, "view");
  const mayInstall = canCompetition(viewer, "edit");
  const installed = workflows.filter((w) => w.installKey).length;

  // Competition forms hold participants' personal data, so they are listed
  // only to the people who run them (T2 Head and above).
  const visible = forms.filter((f) =>
    competitionByForm.has(f.id)
      ? seesCompetition
      : can(viewer, "read", { kind: "form", departmentId: f.departmentId, ownerId: f.ownerId }),
  );

  // Google Form links are no longer supported; old rows stay in the database
  // but are not listed.
  const internal = visible.filter((f) => f.type === "internal");

  const canCreate =
    can(viewer, "create", { kind: "form", departmentId: null, ownerId: viewer.id }) ||
    departments.some((d) =>
      can(viewer, "create", { kind: "form", departmentId: d.id, ownerId: viewer.id }),
    );

  const section = (list: typeof visible) => (
    <Card>

      {list.length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <ul className="space-y-2.5">
          {list.map((form) => {
            const overdue = form.deadline && form.deadline.getTime() < Date.now();

            return (
              <li
                key={form.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3 transition hover:border-brand"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">
                    <Link href={`/forms/${form.id}`} className="hover:text-brand-deep">
                      {form.title}
                    </Link>
                  </p>
                  {form.description ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">{form.description}</p>
                  ) : null}
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-faint">
                    {form.department ? (
                      <span className="flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: form.department.color }}
                          aria-hidden="true"
                        />
                        {form.department.name}
                      </span>
                    ) : (
                      <span>Portal-wide</span>
                    )}
                    <span>· {form.owner.nickname || form.owner.name}</span>
                    {form.deadline ? (
                      <span className={overdue ? "font-semibold text-danger-strong" : ""}>
                        · closes {formatDateLong(form.deadline)}
                      </span>
                    ) : null}
                    {competitionByForm.has(form.id) ? (
                      <span className="font-semibold text-brand-deep">
                        · Competition, {competitionByForm.get(form.id)!.track} track ·{" "}
                        {competitionByForm.get(form.id)!.status === "published" ? "published" : "private draft"}
                      </span>
                    ) : !form.isOpen ? (
                      <span>· closed</span>
                    ) : null}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="hs-pill bg-tint text-brand-deep">
                    {competitionByForm.has(form.id)
                      ? `${competitionByForm.get(form.id)!._count.teams} teams`
                      : `${form._count.responses} responses`}
                  </span>
                  <Link href={`/forms/${form.id}`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
                    Open
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );

  return (
    <div className="hs-enter space-y-5">
      <PageHeader
        eyebrow="Forms hub"
        title="Forms"
        action={
          canCreate ? (
            <Link href="/forms/new" className="hs-btn hs-btn-primary">
              <span aria-hidden="true">＋</span> New form
            </Link>
          ) : null
        }
      />

      {mayInstall && installed < 2 ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              The 2027 internal and external Round 1 forms are not installed yet. They arrive as private drafts.
            </p>
            <form action={installCompetitionDrafts}>
              <button type="submit" className="hs-btn hs-btn-primary">
                Install 2027 competition drafts
              </button>
            </form>
          </div>
        </Card>
      ) : null}

      {section(internal)}
    </div>
  );
}
