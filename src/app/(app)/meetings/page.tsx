import Link from "next/link";
import { requirePageAccess, atLeast, canEditPage } from "@/lib/authorize";
import { db } from "@/lib/db";
import { canReadEntry } from "@/lib/workspace-policy";
import { PageHeader } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Meetings() {
  const v = await requirePageAccess("calendar");
  const rows = await db.calendarEntry.findMany({
    where: { kind: "meeting", deletedAt: null },
    orderBy: { startsAt: "asc" },
  });
  const entries = rows.filter((x) => canReadEntry(v, x));
  return (
    <div className="hs-enter space-y-4">
      <PageHeader
        eyebrow="Workspace"
        title="Meetings"
        subtitle="Agendas, slides, notes and next steps for every team."
        action={
          v.isActive &&
          !v.isAlumni &&
          atLeast(v, "T2_HEAD") &&
          canEditPage(v, "calendar") ? (
            <Link href="/meetings/new" className="hs-btn hs-btn-primary">
              New meeting
            </Link>
          ) : null
        }
      />
      <Link href="/calendar" className="hs-btn hs-btn-secondary">
        Calendar
      </Link>
      {entries.length ? (
        entries.map((e) => (
          <Link
            key={e.id}
            href={`/meetings/${e.id}`}
            className="hs-card block p-4"
          >
            <span className="text-xs text-muted">
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Bangkok",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(e.startsAt)}{" "}
              · Bangkok
            </span>
            <h2 className="font-semibold">{e.title}</h2>
            <p className="line-clamp-2 text-sm text-muted">{e.body}</p>
          </Link>
        ))
      ) : (
        <div className="hs-card p-5">No meetings shared with you yet.</div>
      )}
    </div>
  );
}
