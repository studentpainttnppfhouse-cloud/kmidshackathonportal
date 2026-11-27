import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireViewer, can } from "@/lib/authorize";
import { audit } from "@/lib/audit";
import { deleteFormResponse } from "@/lib/actions/forms";
import { answerText, isUpload, parseDefinition, type ResponsePayload } from "@/lib/forms-schema";
import { canRenderInline } from "@/lib/attachments";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Avatar, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { redirect } from "next/navigation";
import { isCompetitionForm } from "@/lib/competition/server";

export const metadata: Metadata = { title: "Form responses" };
export const dynamic = "force-dynamic";

/** One table per form, Airtable style: a row per response, a column per field. */
export default async function FormResponsesPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  // Competition registrations are listed, with their statuses, on the form page.
  if (await isCompetitionForm(id)) redirect(`/forms/${id}`);

  const form = await db.form.findUnique({
    where: { id },
    select: { id: true, title: true, type: true, schema: true, deletedAt: true, ownerId: true, departmentId: true },
  });
  if (!form || form.deletedAt || form.type !== "internal") notFound();

  // Responses are other people's answers: only whoever runs the form reads them.
  if (!can(viewer, "update", { kind: "form", departmentId: form.departmentId, ownerId: form.ownerId })) {
    await audit(viewer.id, "form.responses.denied", {
      type: "form",
      id: form.id,
      detail: `Denied viewing responses to "${form.title}": not the form's owner or an admin`,
    });
    notFound();
  }

  const definition = parseDefinition(form.schema);
  const responses = await db.formResponse.findMany({
    where: { formId: form.id },
    include: { user: { select: { id: true, name: true, nickname: true, avatarUrl: true } } },
    orderBy: { submittedAt: "desc" },
    take: 500,
  });

  const files = await db.attachment.findMany({
    where: { parentType: "form_response", parentId: { in: responses.map((r) => r.id) }, deletedAt: null },
    select: { id: true, name: true, mimeType: true },
  });
  const fileById = new Map(files.map((f) => [f.id, f]));

  return (
    <div className="hs-enter space-y-5">
      <Link href={`/forms/${form.id}`} className="text-sm font-semibold text-brand-deep">
        ← Back to the form
      </Link>
      <PageHeader
        eyebrow="Responses"
        title={form.title}
        action={
          <span className="flex flex-wrap items-center gap-2">
            <span className="hs-pill bg-tint text-brand-deep">{responses.length} responses</span>
            {responses.length > 0 ? (
              <a href={`/api/forms/${form.id}/export`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
                Export CSV
              </a>
            ) : null}
          </span>
        }
      />

      {!definition ? (
        <EmptyState title="This form has no valid questions" />
      ) : responses.length === 0 ? (
        <EmptyState title="Nobody has answered yet" hint="Share the link and check back." />
      ) : (
        <div className="hs-card overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr className="border-b border-line text-left">
                <th scope="col" className="hs-eyebrow sticky left-0 bg-surface-2 px-3 py-2">
                  Who
                </th>
                <th scope="col" className="hs-eyebrow px-3 py-2">
                  Email
                </th>
                {definition.questions.map((question) => (
                  <th key={question.id} scope="col" className="hs-eyebrow min-w-[10rem] px-3 py-2">
                    {question.label}
                  </th>
                ))}
                <th scope="col" className="hs-eyebrow px-3 py-2">
                  Submitted
                </th>
                <th scope="col" className="sr-only">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {responses.map((response) => {
                const payload = response.payload as ResponsePayload;
                return (
                  <tr key={response.id} className="border-b border-line align-top last:border-0">
                    <td className="sticky left-0 bg-surface px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <Avatar
                          name={response.user?.name ?? response.respondentEmail ?? "Guest"}
                          nickname={response.user?.nickname}
                          url={response.user?.avatarUrl}
                          size={22}
                        />
                        <span className="truncate">
                          {response.user?.nickname || response.user?.name || "Guest"}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted">{response.respondentEmail ?? "—"}</td>
                    {definition.questions.map((question) => {
                      if (isUpload(question.type)) {
                        const ids = Array.isArray(payload[question.id]) ? (payload[question.id] as string[]) : [];
                        const list = ids.map((fid) => fileById.get(fid)).filter((f) => f !== undefined);
                        return (
                          <td key={question.id} className="px-3 py-2.5">
                            {list.length === 0 ? (
                              <span className="text-faint">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {list.map((file) =>
                                  file.mimeType.startsWith("image/") && canRenderInline(file.mimeType) ? (
                                    <a key={file.id} href={`/api/attachments/${file.id}?inline=1`} target="_blank" rel="noreferrer">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={`/api/attachments/${file.id}?inline=1`}
                                        alt={file.name}
                                        className="h-12 w-12 rounded border border-line object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <a
                                      key={file.id}
                                      href={`/api/attachments/${file.id}`}
                                      className="hs-pill max-w-[10rem] truncate bg-tint text-brand-deep"
                                    >
                                      📎 {file.name}
                                    </a>
                                  ),
                                )}
                              </div>
                            )}
                          </td>
                        );
                      }
                      return (
                        <td key={question.id} className="whitespace-pre-line px-3 py-2.5 text-muted">
                          {answerText(payload, question) || "—"}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-faint">
                      {formatDateTime(response.submittedAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <ConfirmDelete
                        action={async () => {
                          "use server";
                          await deleteFormResponse(response.id);
                        }}
                        label="Remove"
                        title="Remove this response?"
                        body="It and its files are deleted for good."
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
