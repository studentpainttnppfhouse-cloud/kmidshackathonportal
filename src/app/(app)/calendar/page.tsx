import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePageAccess, isAdmin } from "@/lib/authorize";
import { PageHeader } from "@/components/ui";
import { AssignmentFilters } from "@/components/assignment-filters";
import { CalendarView, type CalendarEventChip } from "../assignments/views";
import { loadTasks } from "../assignments/query";
import { canManageCalendar, canEditCalendarEvent } from "@/lib/calendar-access";
import { Attachments } from "@/components/attachments";
import { listAttachments } from "@/lib/attachment-access";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { safeHref } from "@/lib/url";
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
  searchParams: Promise<{ dept?: string; status?: string; month?: string; day?: string; event?: string }>;
}) {
  const viewer = await requirePageAccess("calendar");
  const sp = await searchParams;
  const { tasks, departments } = await loadTasks(viewer, { dept: sp.dept, status: sp.status });

  const today = bangkok(new Date());
  const requested = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(sp.month ?? "");
  const month = requested
    ? new Date(Number(requested[1]), Number(requested[2]) - 1, 1)
    : new Date(today.year, today.month, 1);
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

  const mayAdd = canManageCalendar(viewer);
  const teams = departments.map((d) => ({ id: d.id, name: d.name }));
  const lockedTeamId = isAdmin(viewer) ? undefined : viewer.departmentId;
  const canEdit = (createdById: string) => canEditCalendarEvent(viewer, createdById);

  const link = (d: Date, day?: number, eventId?: string) => {
    const params = new URLSearchParams();
    params.set("month", monthKey(d));
    if (sp.dept) params.set("dept", sp.dept);
    if (sp.status) params.set("status", sp.status);
    if (day) params.set("day", String(day));
    if (eventId) params.set("event", eventId);
    return `/calendar?${params}${day ? "#meetings" : ""}`;
  };

  const day = Number(sp.day);
  const selectedDay = Number.isInteger(day) && day >= 1 && day <= new Date(y, m + 1, 0).getDate() ? day : undefined;
  const selectedDate = selectedDay ? `${monthKey(month)}-${pad(selectedDay)}` : undefined;
  const dayEvents = events.filter((event) => event.day === selectedDay);
  const selectedEvent = dayEvents.find((event) => event.id === sp.event);
  const teamSteps = selectedEvent?.teamNextSteps;
  const perTeam = teamSteps && typeof teamSteps === "object" && !Array.isArray(teamSteps)
    ? Object.fromEntries(Object.entries(teamSteps).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  const slides = safeHref(selectedEvent?.slidesUrl);
  const meetingFiles = selectedEvent?.isMeeting ? await listAttachments("meeting", selectedEvent.id) : [];

  return (
    <div className="hs-enter space-y-4">
      <PageHeader
        eyebrow="Workspace"
        title="Calendar"
        action={
          <div className="flex flex-wrap gap-1.5">
            {mayAdd ? (
              <AddEventButton
                teams={teams}
                lockedTeamId={lockedTeamId}
              />
            ) : null}
            <Link href={link(prev)} className="hs-btn hs-btn-secondary" aria-label="Previous month">←</Link>
            <Link href={link(new Date(today.year, today.month, 1), today.day)} className="hs-btn hs-btn-secondary">Today</Link>
            <Link href={link(next)} className="hs-btn hs-btn-secondary" aria-label="Next month">→</Link>
          </div>
        }
      />
      <AssignmentFilters
        departments={departments}
        dept={sp.dept}
        status={sp.status}
        keep={{ month: monthKey(month), day: selectedDay?.toString() }}
      />
      <CalendarView items={tasks} month={month} events={chips} selectedDay={selectedDay}
        dayHref={(day, eventId) => link(month, day, eventId)} />

      <section id="meetings" className="hs-card scroll-mt-6 space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="hs-h2">Meetings</h2>
            <p className="text-sm text-muted">{selectedDate
              ? new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Asia/Bangkok" }).format(new Date(`${selectedDate}T12:00:00+07:00`))
              : "Select a date or meeting on the calendar."}</p>
          </div>
          {mayAdd && selectedDate ? <AddEventButton key={selectedDate} date={selectedDate} teams={teams} lockedTeamId={lockedTeamId} /> : null}
        </div>
        {selectedDate && !dayEvents.length ? <p className="text-sm text-muted">No meetings or events on this date.</p> : null}
        {dayEvents.length ? (
          <ul className="flex flex-wrap gap-2">
            {dayEvents.map((event) => (
              <li key={event.id}><Link href={link(month, event.day, event.id)} aria-current={event.id === sp.event ? "true" : undefined}
                className={`hs-btn ${event.id === sp.event ? "hs-btn-primary" : "hs-btn-secondary"}`}>
                {event.time ? `${event.time} · ` : ""}{event.title}
              </Link></li>
            ))}
          </ul>
        ) : null}
        {selectedEvent && selectedDate ? (
          <article className="space-y-4 border-t border-line pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-ink">{selectedEvent.title}</h3>
                <p className="text-sm text-muted">{[selectedEvent.teamName, selectedEvent.location].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {slides ? <a href={slides} target="_blank" rel="noreferrer" className="hs-btn hs-btn-secondary">Open slides ↗</a> : null}
                {canEdit(selectedEvent.createdById) ? (
                  <AddEventButton key={selectedEvent.id} teams={teams} lockedTeamId={lockedTeamId} meeting={{
                    ...selectedEvent, date: selectedDate, start: selectedEvent.time, end: selectedEvent.endTime, teamNextSteps: perTeam,
                  }} />
                ) : null}
              </div>
            </div>
            {[
              ["Notes", selectedEvent.notes],
              ["Meeting summary", selectedEvent.summary],
              ["Overall next steps", selectedEvent.nextSteps],
            ].map(([label, value]) => value ? (
              <div key={label}><h4 className="text-sm font-semibold">{label}</h4>
                <p className="whitespace-pre-wrap break-words text-sm text-muted">{value}</p></div>
            ) : null)}
            {Object.keys(perTeam).length ? (
              <div>
                <h4 className="text-sm font-semibold">Next steps by team</h4>
                <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                  {teams.filter((team) => perTeam[team.id]).map((team) => (
                    <div key={team.id}><dt className="text-sm font-semibold">{team.name}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm text-muted">{perTeam[team.id]}</dd></div>
                  ))}
                </dl>
              </div>
            ) : null}
            {selectedEvent.isMeeting ? (
              <div className="border-t border-line pt-4">
                <Attachments parentType="meeting" parentId={selectedEvent.id} title="Meeting files"
                  hint="Upload the slide deck or other meeting materials"
                  canWrite={canEdit(selectedEvent.createdById)} attachments={meetingFiles}
                  viewerId={viewer.id} maxBytes={MAX_UPLOAD_BYTES} />
              </div>
            ) : null}
          </article>
        ) : null}
      </section>

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
                  <Link href={link(month, e.day, e.id)} className="text-sm font-semibold text-ink hover:underline">{e.title}</Link>
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
                {canEdit(e.createdById) ? <DeleteEventButton id={e.id} title={e.title} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
