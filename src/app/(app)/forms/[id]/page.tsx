import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireViewer, can } from "@/lib/authorize";
import { setFormOpen } from "@/lib/actions/forms";
import { answerText, isPublicForm, isUpload, parseDefinition, type ResponsePayload } from "@/lib/forms-schema";
import { appOrigin } from "@/lib/request";
import { FormShare } from "@/components/form-share";
import { QrCode } from "@/components/qr";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { FormFill, type StoredFile } from "@/components/form-fill";
import { Banner, LastUpdated } from "@/components/ui";
import { formatDateLong } from "@/lib/dates";
import { loadWorkflow } from "@/lib/competition/server";
import { CompetitionManage } from "@/components/competition-manage";

export const metadata: Metadata = { title: "Form" };
export const dynamic = "force-dynamic";

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;

  const competition = await loadWorkflow(id);
  if (competition) return <CompetitionManage loaded={competition} viewer={viewer} />;

  const form = await db.form.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, nickname: true } },
      department: { select: { name: true, color: true } },
    },
  });

  if (!form || form.deletedAt) notFound();

  const resource = { kind: "form" as const, departmentId: form.departmentId, ownerId: form.ownerId };
  if (!can(viewer, "read", resource)) notFound();

  const manages = can(viewer, "update", resource);
  const definition = parseDefinition(form.schema);

  if (form.type !== "internal") notFound();
  const isPublic = isPublicForm(definition);
  const shareUrl = `${await appOrigin()}/f/${form.id}`;

  const mine = await db.formResponse.findFirst({
    where: { formId: form.id, userId: viewer.id },
    select: { id: true, payload: true },
  });
  const responseCount = manages ? await db.formResponse.count({ where: { formId: form.id } }) : 0;
  const closed = !form.isOpen || (form.deadline !== null && form.deadline.getTime() < Date.now());

  // Files the viewer already sent, so the upload fields can show them.
  const existingFiles: Record<string, StoredFile[]> = {};
  if (mine && definition) {
    const payload = mine.payload as ResponsePayload;
    const rows = await db.attachment.findMany({
      where: { parentType: "form_response", parentId: mine.id, deletedAt: null },
      select: { id: true, name: true, mimeType: true, size: true },
    });
    for (const question of definition.questions) {
      const ids = payload[question.id];
      if (!isUpload(question.type) || !Array.isArray(ids)) continue;
      existingFiles[question.id] = rows.filter((row) => ids.includes(row.id));
    }
  }

  return (
    <div className="hs-enter space-y-5">
      <div className="hs-no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/forms" className="text-sm font-semibold text-brand-deep">
          ← All forms
        </Link>
        {manages ? (
          <div className="flex flex-wrap items-center gap-2">
            <FormShare
              url={shareUrl}
              isPublic={isPublic}
              qr={<QrCode value={shareUrl} size={160} title={`QR code for ${form.title}`} />}
            />
            <Link href={`/forms/${form.id}/responses`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
              Responses · {responseCount}
            </Link>
            <Link href={`/forms/${form.id}/edit`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
              Edit form
            </Link>
            <form
              action={async () => {
                "use server";
                await setFormOpen(form.id, !form.isOpen);
              }}
            >
              <button type="submit" className="hs-btn hs-btn-ghost px-3 py-1.5 text-xs">
                {form.isOpen ? "Close form" : "Reopen"}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2">
        <span className="text-xs text-faint">{form.department?.name ?? "Portal-wide"}</span>
        <span className="hs-pill bg-tint text-brand-deep">{isPublic ? "Anyone with the link" : "Staff only"}</span>
        <span className={`hs-pill ${closed ? "bg-neutral-soft text-neutral-strong" : "bg-ok-soft text-ok-strong"}`}>
          {closed ? "Closed" : "Open"}
        </span>
        {form.deadline ? (
          <span className="hs-pill bg-warn-soft text-warn-strong">Closes {formatDateLong(form.deadline)}</span>
        ) : null}
      </div>

      {!definition ? (
        <Banner tone="warn">
          This form has no questions saved. {manages ? "Edit it to add some." : "Ask its owner to finish it."}
        </Banner>
      ) : closed ? (
        <div className="hs-card mx-auto max-w-2xl p-5 sm:p-8">
          <h1 className="text-2xl font-bold text-ink">{form.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {form.deadline && form.deadline.getTime() < Date.now()
              ? `Not accepting answers. The deadline passed on ${formatDateLong(form.deadline)}.`
              : "Not accepting answers. The person running this form has closed it."}
          </p>
          {mine ? (
            <div className="mt-5">
              <h2 className="hs-eyebrow mb-2">What you answered</h2>
              <dl className="space-y-2 text-sm">
                {definition.questions.map((question) => (
                  <div key={question.id}>
                    <dt className="text-xs font-semibold text-faint">{question.label}</dt>
                    <dd className="text-muted">
                      {isUpload(question.type)
                        ? (existingFiles[question.id] ?? []).map((f) => f.name).join(", ") || "—"
                        : answerText(mine.payload as ResponsePayload, question) || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      ) : (
        <FormFill
          formId={form.id}
          title={form.title}
          description={form.description}
          definition={definition}
          existing={mine ? (mine.payload as ResponsePayload) : null}
          existingFiles={existingFiles}
          maxBytes={MAX_UPLOAD_BYTES}
          askEmail={isPublic}
          lockedEmail={viewer.email}
        />
      )}

      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 pt-2 text-xs text-faint">
        <span>Run by {form.owner.nickname || form.owner.name}</span>
        <LastUpdated at={form.updatedAt} />
      </div>
    </div>
  );
}
