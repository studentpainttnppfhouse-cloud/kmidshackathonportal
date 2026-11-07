import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/authorize";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { DriveForm } from "@/components/workspace-forms";
import { Attachments } from "@/components/attachments";
import { listAttachments } from "@/lib/attachment-access";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { readDrive, canEditDrive, ids } from "@/lib/workspace-access";
import { renderMarkdown } from "@/lib/markdown";
export default async function DrivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const v = await requirePageAccess("documents");
  const { id } = await params;
  const sp = await searchParams;
  const d = await db.driveItem.findUnique({ where: { id } });
  if (!d || !(await readDrive(v, d))) notFound();
  const editable = canEditDrive(v, d);
  if (sp.edit && editable) {
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
        <PageHeader eyebrow="Workspace" title="Edit document" />
        <DriveForm
          item={{ ...d, sharedUserIds: ids(d.sharedUserIds) }}
          people={people.filter((p) => p.id !== v.id)}
          departments={departments}
        />
      </div>
    );
  }
  const attachments = await listAttachments("drive", id);
  return (
    <div className="hs-enter space-y-4">
      <Link href="/drive" className="hs-btn hs-btn-secondary">
        ← Portal drive
      </Link>
      <PageHeader
        eyebrow="Workspace"
        title={d.title}
        subtitle={
          d.scope === "private"
            ? "Private · only you and any task recipients you explicitly submit to"
            : `Shared: ${d.scope}`
        }
        action={
          editable ? (
            <Link
              href={`/drive/${id}?edit=1`}
              className="hs-btn hs-btn-primary"
            >
              Edit / share
            </Link>
          ) : null
        }
      />
      {d.kind === "document" ? (
        <>
          <div className="flex gap-2">
            {["docx", "pdf", "md"].map((f) => (
              <a
                key={f}
                href={`/drive/${id}/export?format=${f}`}
                className="hs-btn hs-btn-secondary"
              >
                {f === "docx" ? "Word (.docx)" : f.toUpperCase()}
              </a>
            ))}
          </div>
          <article className="hs-card p-6">
            <div
              className="hs-prose"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(d.body ?? "") }}
            />
          </article>
        </>
      ) : d.body ? (
        <p className="hs-card whitespace-pre-wrap p-5">{d.body}</p>
      ) : null}
      <div className="hs-card p-5">
        <Attachments
          parentType="drive"
          parentId={id}
          canWrite={editable}
          attachments={attachments}
          viewerId={v.id}
          maxBytes={MAX_UPLOAD_BYTES}
          title="Files in this item"
        />
      </div>
    </div>
  );
}
