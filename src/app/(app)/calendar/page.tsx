import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireViewer, isAdmin } from "@/lib/authorize";
import { PageHeader } from "@/components/ui";
import { AssignmentFilters } from "@/components/assignment-filters";
import { CalendarView, type CalendarEventChip } from "../assignments/views";
import { loadTasks } from "../assignments/query";
import { AddEventButton, DeleteEventButton } from "./event-tools";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Bangkok wall-clock parts for a stored instant. */
function bangkok(d: Date) {
  const b = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return {
    year: b.getUTCFullYear(),
    month: b.getUTCMonth(),
    day: b.getUTCDate(),
    time: `${String(b.getUTCHours()).padStart(2, "0")}:${String(b.getUTCMinutes()).padStart(2, "0")}`,
  };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; status?: string; month?: string }>;
}) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const { tasks, departments } = await loadTasks(viewer, { dept: sp.dept, status: sp.status });

  const parsed = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? new Date(`${sp.month}-01T00:00:00+07:00`) : null;
  const month = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  const prev = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const y = month.getFullYear();
  const m = month.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = new Date(`${y}-${pad(m + 1)}-01T00:00:00+07:00`);
  const to = new Date(`${m === 11 ? y + 1 : y}-${pad(m === 11 ? 1 : m + 2)}-01T00:00:00+07:00`);

  const deptFilter = departments.find((d) => d.slug === sp.dept || d.id === sp.dept);
  const rows = await db.calendarEvent.findMany({
    where: {
      startsAt: { gte: from, lt: to },
      ...(deptFilter ? { OR: [{ departmentId: null }, { departmentId: deptFilter.id }] } : {}),
    },
    orderBy: { startsAt: "asc" },
  });
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const creators = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } },
    select: { id: true, name: true, nickname: true },
  });
  const creatorName = new Map(creators.map((c) => [c.id, c.nickname || c.name]));

  const events = rows.map((r) => {
    const s = bangkok(r.startsAt);
    const dept = r.departmentId ? deptById.get(r.departmentId) : undefined;
    return {
      ...r,
      day: s.day,
      time: r.allDay ? null : s.time,
      endTime: r.endsAt ? bangkok(r.endsAt).time : null,
      teamName: dept?.name ?? "All staff",
      color: dept?.color ?? "#64748B",
    };
  });
  const chips: CalendarEventChip[] = events.map((e) => ({
    id: e.id, day: e.day, title: e.title, time: e.time, color: e.color,
  }));

  const mayAdd = viewer.isActive && !viewer.isAlumni && (isAdmin(viewer) || viewer.tier === "T2_HEAD");
  const canDelete = (createdById: string) => mayAdd && (isAdmin(viewer) || createdById === viewer.id);

  const link = (d: Date) => {
    const params = new URLSearchParams();
    params.set("month", monthKey(d));
    if (sp.dept) params.set("dept", sp.dept);
    if (sp.status) params.set("status", sp.status);
    return `/calendar?${params}`;
  };

  return (
    <div className="hs-enter space-y-4">
      <PageHeader
        eyebrow="Workspace"
        title="Calendar"
        action={
          <div className="flex flex-wrap gap-1.5">
            {mayAdd ? (
              <AddEventButton
                teams={departments.map((d) => ({ id: d.id, name: d.name }))}
                lockedTeamId={isAdmin(viewer) ? undefined : viewer.departmentId}
              />
            ) : null}
            <Link href={link(prev)} className="hs-btn hs-btn-secondary" aria-label="Previous month">←</Link>
            <Link href="/calendar" className="hs-btn hs-btn-secondary">Today</Link>
            <Link href={link(next)} className="hs-btn hs-btn-secondary" aria-label="Next month">→</Link>
          </div>
        }
      />
      <AssignmentFilters
        departments={departments}
        dept={sp.dept}
        status={sp.status}
        keep={{ month: sp.month }}
      />
      <CalendarView items={tasks} month={month} events={chips} />

      <section className="hs-card p-4">
        <h2 className="mb-3 text-sm font-bold text-brand-deep">Events this month</h2>
        {events.length === 0 ? (
          <p className="text-sm text-faint">
            No events yet.{mayAdd ? " Use “Add event” to put one on the calendar." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} id={`event-${e.id}`} className="flex items-start gap-3 py-2.5">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: e.color }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{e.title}</p>
                  <p className="text-xs text-muted">
                    {new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Bangkok" }).format(e.startsAt)}
                    {" · "}
                    {e.time ? `${e.time}${e.endTime ? `–${e.endTime}` : ""}` : "All day"}
                    {e.location ? ` · ${e.location}` : ""}
                    {` · ${e.teamName}`}
                    {` · added by ${creatorName.get(e.createdById) ?? "someone"}`}
                  </p>
                  {e.notes ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{e.notes}</p> : null}
                </div>
                {canDelete(e.createdById) ? <DeleteEventButton id={e.id} title={e.title} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
