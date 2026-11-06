import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireViewer, can } from "@/lib/authorize";
import { deleteAssignment } from "@/lib/actions/assignments";
import { formatDateLong, isOverdue, relativeDue, timeAgo } from "@/lib/dates";
import { AssignmentForm } from "@/components/assignment-form";
import { AttachmentList, Attachments } from "@/components/attachments";
import { CommentForm } from "@/components/comments";
import { StatusButtons } from "@/components/status-buttons";
import { Avatar, Banner, Card, PriorityPill, SectionTitle, StatusPill } from "@/components/ui";
import { listAttachments } from "@/lib/attachment-access";
import { CaptionField } from "@/components/media-captions";
import { canEditMediaCaptions } from "@/lib/media-handoff";
import { safeHref } from "@/lib/url";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;

  const a = await db.assignment.findUnique({
    where: { id },
    include: {
      department: true,
      createdBy: { select: { id: true, name: true, nickname: true, avatarUrl: true } },
      assignees: {
        select: { user: { select: { id: true, name: true, nickname: true, avatarUrl: true } } },
      },
    },
  });

  if (!a || a.deletedAt) notFound();

  const resource = {
    kind: "assignment" as const,
    departmentId: a.departmentId,
    createdById: a.createdById,
    ownerIds: a.assignees.map((x) => x.user.id),
  };

  if (!can(viewer, "read", resource)) notFound();

  const mayEdit = can(viewer, "update", resource);
  const mayApprove = can(viewer, "approve", resource);
  const mayDelete = can(viewer, "delete", resource);
  const mayAssign = can(viewer, "assign", resource);

  const [comments, departments, people, attachments] = await Promise.all([
    db.comment.findMany({
      where: { parentType: "assignment", parentId: a.id, deletedAt: null },
      include: { user: { select: { name: true, nickname: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    }),
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
    listAttachments("assignment", a.id),
  ]);

  const source = a.mediaSourceId ? await db.assignment.findFirst({
    where: { id: a.mediaSourceId, deletedAt: null, status: { in: ["APPROVED", "DONE"] } },
    select: { id: true, title: true, linkUrl: true, departmentId: true, createdById: true,
      assignees: { select: { userId: true } } },
  }) : null;
  const approvedSource = source && can(viewer, "read", {
    kind: "assignment", departmentId: source.departmentId, createdById: source.createdById,
    ownerIds: source.assignees.map(({ userId }) => userId),
  }) ? source : null;
  const approvedFiles = approvedSource ? await listAttachments("assignment", approvedSource.id) : [];
  const sourceLink = safeHref(approvedSource?.linkUrl);
  const mayCaption = a.department.slug === "social" && canEditMediaCaptions(viewer, a.departmentId);

  const overdue = isOverdue(a.dueDate, a.status);

  return (
    <div className="space-y-5">
      <Link href="/assignments" className="text-sm font-semibold text-brand-deep">
        ← All assignments
      </Link>

      {overdue ? <Banner tone="danger">This task is {relativeDue(a.dueDate).toLowerCase()}.</Banner> : null}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/departments/${a.department.slug}`}
              className="hs-eyebrow hover:text-brand-deep"
            >
              {a.department.name}
            </Link>
            <h1 className="hs-h1 mt-0.5">{a.title}</h1>
          </div>
          <div className="flex shrink-0 gap-2">
            <StatusPill status={a.status} />
            <PriorityPill priority={a.priority} />
          </div>
        </div>

        {a.description ? (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {a.description}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="hs-eyebrow">Due</dt>
            <dd className={`mt-0.5 font-semibold ${overdue ? "text-danger-strong" : "text-ink"}`}>
              {formatDateLong(a.dueDate)}
            </dd>
          </div>
          <div>
            <dt className="hs-eyebrow">Created by</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 font-semibold text-ink">
              <Avatar
                name={a.createdBy.name}
                nickname={a.createdBy.nickname}
                url={a.createdBy.avatarUrl}
                size={20}
              />
              {a.createdBy.nickname || a.createdBy.name}
            </dd>
          </div>
          <div>
            <dt className="hs-eyebrow">Assigned to</dt>
            <dd className="mt-0.5 flex flex-wrap gap-2">
              {a.assignees.length === 0 ? (
                <span className="text-faint">Nobody yet</span>
              ) : (
                a.assignees.map((x) => (
                  <Link
                    key={x.user.id}
                    href={`/people/${x.user.id}`}
                    className="flex items-center gap-1.5 rounded-full bg-tint py-0.5 pl-0.5 pr-2.5 text-xs font-semibold text-brand-deep"
                  >
                    <Avatar
                      name={x.user.name}
                      nickname={x.user.nickname}
                      url={x.user.avatarUrl}
                      size={20}
                    />
                    {x.user.nickname || x.user.name}
                  </Link>
                ))
              )}
            </dd>
          </div>
        </dl>

        {a.recurrence ? (
          <p className="mt-4 text-xs text-faint">Repeats: {a.recurrence}</p>
        ) : null}

        {a.linkUrl ? (
          <a
            href={a.linkUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="hs-btn hs-btn-secondary mt-4"
          >
            Open linked document ↗
          </a>
        ) : null}

        {mayEdit ? (
          <div className="mt-5 border-t border-line-soft pt-4">
            <p className="hs-eyebrow mb-2">Move this task</p>
            <StatusButtons id={a.id} current={a.status} canApprove={mayApprove} />
          </div>
        ) : null}
      </Card>

      {/* Files live between the brief and the conversation, because that is
          what they are: the thing the task is about. Whoever set the task and
          whoever it is set for can both add to it — `mayEdit` is exactly that
          pair, plus the head and the admins above them. */}
      <Card>
        <Attachments
          parentType="assignment"
          parentId={a.id}
          canWrite={mayEdit}
          attachments={attachments}
          viewerId={viewer.id}
          maxBytes={MAX_UPLOAD_BYTES}
          title="Files on this task"
          hint="The brief, and the work sent back"
        />
      </Card>

      {a.mediaSourceId ? (
        <Card>
          <SectionTitle>Approved media and captions</SectionTitle>
          {approvedSource ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Link href={`/assignments/${approvedSource.id}`} className="hs-btn hs-btn-secondary">
                  Graphics assignment · {approvedSource.title}
                </Link>
                {sourceLink ? <a href={sourceLink} target="_blank" rel="noreferrer" className="hs-btn hs-btn-secondary">Open linked media ↗</a> : null}
              </div>
              {approvedFiles.length ? <AttachmentList attachments={approvedFiles} viewerId={viewer.id}
                canWrite={false} allowRemoval={false} mediaDetails /> : null}
              {!approvedFiles.length && !sourceLink ? <p className="text-sm text-muted">Graphics hasn’t attached media yet.</p> : null}
              <p className="text-sm text-muted">Captions save as you type. Copy either language when you’re ready to post.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <CaptionField assignmentId={a.id} language="th" initial={a.captionTh ?? ""} editable={mayCaption} />
                <CaptionField assignmentId={a.id} language="en" initial={a.captionEn ?? ""} editable={mayCaption} />
              </div>
            </div>
          ) : <p className="text-sm text-muted">The source assignment is awaiting approval or unavailable.</p>}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Comments</SectionTitle>
        {comments.length === 0 ? (
          <p className="mb-4 text-sm text-faint">No comments yet.</p>
        ) : (
          <ul className="mb-4 space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <Avatar
                  name={c.user.name}
                  nickname={c.user.nickname}
                  url={c.user.avatarUrl}
                  size={30}
                />
                <div className="min-w-0 flex-1 rounded-xl bg-tint/70 px-3 py-2">
                  <p className="text-xs font-semibold text-brand-deep">
                    {c.user.nickname || c.user.name}
                    <span className="ml-1.5 font-normal text-faint">{timeAgo(c.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <CommentForm parentType="assignment" parentId={a.id} />
      </Card>

      {mayEdit ? (
        <Card>
          <SectionTitle>Edit task</SectionTitle>
          <AssignmentForm
            departments={departments.map((d) => ({ id: d.id, name: d.name }))}
            people={people}
            canAssignOthers={mayAssign}
            canApprove={mayApprove}
            viewerId={viewer.id}
            teams={departments.map((d) => ({ id: d.id, name: d.name }))}
            assignment={{
              id: a.id,
              title: a.title,
              description: a.description,
              departmentId: a.departmentId,
              dueDate: a.dueDate,
              priority: a.priority,
              status: a.status,
              linkUrl: a.linkUrl,
              recurrence: a.recurrence,
              assigneeIds: a.assignees.map((x) => x.user.id),
            }}
          />
        </Card>
      ) : null}

      {mayDelete ? (
        <form
          action={async () => {
            "use server";
            await deleteAssignment(a.id);
            redirect("/assignments");
          }}
        >
          <button type="submit" className="hs-btn hs-btn-danger">
            Move to recycle bin
          </button>
          <p className="mt-1.5 text-xs text-faint">
            Nothing is hard-deleted. An owner can restore this from the admin panel.
          </p>
        </form>
      ) : null}
    </div>
  );
}
