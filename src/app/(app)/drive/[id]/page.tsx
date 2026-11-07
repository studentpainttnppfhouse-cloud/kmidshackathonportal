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
import { DriveOpenTracker, DriveShareButton } from "@/components/drive-sharing";
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
  const [people, departments, owner] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.department.findMany({
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.user.findUnique({
      where: { id: d.ownerId },
      select: { name: true, nickname: true },
    }),
  ]);
  if (sp.edit && editable) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Workspace" title="Edit document" />
        <DriveForm
          item={{
            ...d,
            sharedUserIds: ids(d.sharedUserIds),
            sharedDepartmentIds: ids(d.sharedDepartmentIds),
          }}
          people={people.filter((p) => p.id !== v.id)}
          departments={departments}
        />
      </div>
    );
  }
  const attachments = await listAttachments("drive", id);
  return (
    <div className="hs-enter space-y-4">
      <DriveOpenTracker id={id} />
      <Link href="/drive" className="hs-btn hs-btn-secondary">
        ← Documents
      </Link>
      <PageHeader
        eyebrow="Workspace"
        title={d.title}
        subtitle={`Created by ${owner?.nickname || owner?.name || "former staff member"} · ${d.scope === "private" ? "Private" : d.scope === "all" ? "Shared with everyone" : "Shared with selected recipients"}`}
        action={
          editable ? (
            <div className="flex gap-2">
              <DriveShareButton
                item={{
                  ...d,
                  sharedUserIds: ids(d.sharedUserIds),
                  sharedDepartmentIds: ids(d.sharedDepartmentIds),
                }}
                people={people.filter((person) => person.id !== v.id)}
                departments={departments}
              />
              <Link
                href={`/drive/${id}?edit=1`}
                className="hs-btn hs-btn-primary"
              >
                Edit document
              </Link>
            </div>
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
          <article className="mx-auto min-h-[42rem] max-w-[52rem] rounded border border-line bg-surface px-6 py-10 shadow-sm sm:px-14">
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
