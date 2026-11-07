import { CalendarImport } from "@/components/calendar-import";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageAccess, canEditPage, atLeast } from "@/lib/authorize";
import { PageHeader } from "@/components/ui";
import {
  WorkspaceCalendar,
  type CalendarCard,
} from "@/components/workspace-calendar";
import { db } from "@/lib/db";
import { loadTasks } from "../assignments/query";
import { bangkokDay, canReadEntry, ids } from "@/lib/workspace-policy";
export const dynamic = "force-dynamic";
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const sp = await searchParams;
  if (sp.event) redirect(`/calendar/${encodeURIComponent(sp.event)}`);
  const v = await requirePageAccess("calendar");
  const [{ tasks }, events] = await Promise.all([
    loadTasks(v, { all: true }),
    db.calendarEntry.findMany({
      where: { deletedAt: null, kind: { not: "meeting" } },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  const teams = await db.department.findMany({
    select: { id: true, name: true, color: true, slug: true },
  });
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const idsBySlug = new Map(teams.map((team) => [team.slug, team.id]));
  const colors = new Map(teams.map((team) => [team.id, team.color]));
  const attendees = await db.user.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, nickname: true, departmentId: true },
  });
  const staffNames = new Map(
    attendees.map((person) => [person.id, person.nickname || person.name]),
  );
  const items: CalendarCard[] = tasks
    .filter((t) => t.dueDate)
    .map((t) => ({
      id: t.id,
      title: t.title,
      date: bangkokDay(t.dueDate!),
      time: "",
      href: `/assignments/${t.id}`,
      kind: "task",
      mine: t.assignees.some((x) => x.user.id === v.id),
      team: t.department.name,
      teamId: idsBySlug.get(t.department.slug) ?? "",
      color: t.department.color,
      assignees: t.assignees.map(({ user }) => ({
        id: user.id,
        name: user.nickname || user.name,
      })),
    }));
  for (const e of events.filter((e) => canReadEntry(v, e)))
    items.push({
      id: e.id,
      title: e.title,
      date: bangkokDay(e.startsAt),
      time: e.allDay
        ? "All day"
        : new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Bangkok",
            hour: "2-digit",
            minute: "2-digit",
          }).format(e.startsAt),
      href: `/calendar/${e.id}`,
      kind: e.kind,
      mine: e.ownerId === v.id || ids(e.attendeeIds).includes(v.id),
      team: names.get(e.departmentId ?? "") ?? "",
      teamId: e.departmentId ?? "",
      color: colors.get(e.departmentId ?? "") ?? "#64748B",
      assignees: ids(e.attendeeIds).map((id) => ({
        id,
        name: staffNames.get(id) ?? "Former staff member",
      })),
    });
  return (
    <div className="hs-enter space-y-4">
      <PageHeader
        eyebrow="Workspace"
        title="Calendar"
        action={
          <div className="flex gap-2">
            <Link href="/meetings" className="hs-btn hs-btn-secondary">
              Meetings
            </Link>
            {canEditPage(v, "calendar") ? (
              <Link href="/calendar/new" className="hs-btn hs-btn-primary">
                New event
              </Link>
            ) : null}
          </div>
        }
      />
      <WorkspaceCalendar
        items={items}
        departments={teams}
        staff={attendees.map((person) => ({
          id: person.id,
          name: person.nickname
            ? `${person.nickname} · ${person.name}`
            : person.name,
          departmentId: person.departmentId,
        }))}
        today={bangkokDay(new Date())}
        initialTeam={v.tier === "T2_HEAD" ? (v.departmentId ?? "") : ""}
        canCreate={
          v.isActive && canEditPage(v, "calendar") && !v.isAlumni && v.tier !== "T0_ADVISOR"
        }
      />
      {atLeast(v, "T3_ADMIN") && canEditPage(v, "calendar") ? (
        <CalendarImport />
      ) : null}
    </div>
  );
}
