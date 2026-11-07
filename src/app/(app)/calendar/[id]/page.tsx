import { Attachments } from "@/components/attachments";
import { listAttachments } from "@/lib/attachment-access";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { safeHref } from "@/lib/url";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/authorize";
import { db } from "@/lib/db";
import { EntryForm } from "@/components/workspace-forms";
import { PageHeader } from "@/components/ui";
import {
  canReadEntry,
  canEditEntry,
  canAssignPerson,
  ids,
  bangkokDay,
} from "@/lib/workspace-policy";
import { TIER_ORDER } from "@/lib/constants";
import { removeEntry } from "@/lib/actions/workspace";
export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const v = await requirePageAccess("calendar");
  const { id } = await params;
  const e = await db.calendarEntry.findUnique({ where: { id } });
  if (!e || !canReadEntry(v, e)) notFound();
  const edit = canEditEntry(v, e);
  const attachments =
    e.kind === "meeting" ? await listAttachments("meeting", id) : [];
  const [people, departments] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
    }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const stamp = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  const input = (d: Date) =>
    bangkokDay(d) +
    "T" +
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  return (
    <div className="space-y-4">
      <Link
        className="hs-btn hs-btn-secondary"
        href={e.kind === "meeting" ? "/meetings" : "/calendar"}
      >
        ← {e.kind === "meeting" ? "Meetings" : "Calendar"}
      </Link>
      <PageHeader
        eyebrow="Workspace"
        title={e.title}
        subtitle={`${e.allDay ? bangkokDay(e.startsAt) + " · All day / time TBC" : stamp(e.startsAt)}${e.endsAt ? " – " + stamp(e.endsAt) : ""} · Bangkok`}
      />
      <article className="hs-card space-y-3 p-5">
        <p>{e.location}</p>
        <p className="whitespace-pre-wrap">{e.body}</p>
        <p className="text-sm text-muted">
          {e.scope === "private" ? "Personal" : e.scope} ·{" "}
          {people
            .filter((p) => ids(e.attendeeIds).includes(p.id))
            .map((p) => p.nickname || p.name)
            .join(", ")}
        </p>
      </article>
      {e.kind === "meeting" ? (
        <div className="hs-card space-y-4 p-5">
          {e.summary ? (
            <section>
              <h2 className="hs-h2">Summary</h2>
              <p className="whitespace-pre-wrap">{e.summary}</p>
            </section>
          ) : null}
          {e.nextSteps ? (
            <section>
              <h2 className="hs-h2">Next steps</h2>
              <p className="whitespace-pre-wrap">{e.nextSteps}</p>
            </section>
          ) : null}
          {e.teamNextSteps &&
          typeof e.teamNextSteps === "object" &&
          !Array.isArray(e.teamNextSteps)
            ? Object.entries(e.teamNextSteps).map(([team, note]) => (
                <section key={team}>
                  <h3 className="font-semibold">
                    {departments.find((d) => d.id === team)?.name ?? "Team"}
                  </h3>
                  <p className="whitespace-pre-wrap">{String(note)}</p>
                </section>
              ))
            : null}
          {safeHref(e.slidesUrl) ? (
            <p className="text-sm text-muted">
              Previous slides reference: {e.slidesUrl}. Upload a local copy
              below to keep slides in the portal.
            </p>
          ) : null}
          <Attachments
            parentType="meeting"
            parentId={id}
            canWrite={edit}
            attachments={attachments}
            viewerId={v.id}
            maxBytes={MAX_UPLOAD_BYTES}
            title="Meeting documents"
          />
        </div>
      ) : null}
      {edit ? (
        <details className="space-y-3">
          <summary className="hs-btn hs-btn-secondary">
            {e.kind === "meeting" ? "Edit meeting" : "Edit event"}
          </summary>
          <EntryForm
            entry={{
              ...e,
              date: bangkokDay(e.startsAt),
              time: input(e.startsAt).slice(11),
              end: e.endsAt ? input(e.endsAt) : "",
              attendeeIds: ids(e.attendeeIds),
              teamNextSteps: e.teamNextSteps,
            }}
            level={TIER_ORDER[v.tier]}
            ownDepartment={v.departmentId}
            people={people
              .filter((p) => e.kind === "meeting" || canAssignPerson(v, p))
              .map((p) => ({
                id: p.id,
                name: p.nickname ? `${p.nickname} · ${p.name}` : p.name,
                departmentId: p.departmentId,
              }))}
            departments={departments.filter(
              (d) =>
                e.kind === "meeting" ||
                TIER_ORDER[v.tier] >= 3 ||
                d.id === v.departmentId,
            )}
          />
          <form
            action={async () => {
              "use server";
              await removeEntry(id);
            }}
          >
            <button className="hs-btn hs-btn-secondary">Remove event</button>
          </form>
        </details>
      ) : (
        <p className="text-sm text-muted">
          Read only. Heads, admins and owners manage shared events.
        </p>
      )}
    </div>
  );
}
