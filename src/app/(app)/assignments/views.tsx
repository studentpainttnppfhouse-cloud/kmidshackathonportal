import Link from "next/link";
import { Avatar, EmptyState, PriorityPill, StatusPill } from "@/components/ui";
import { AssignmentRow, type AssignmentSummary } from "@/components/assignment-row";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { formatDate, isOverdue, relativeDue } from "@/lib/dates";
import { swatchStyle } from "@/lib/color";

export function BoardView({ items }: { items: AssignmentSummary[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {STATUS_ORDER.map((status) => {
        const column = items.filter((a) => a.status === status);
        return (
          <section key={status} className="rounded-2xl bg-surface/50 p-3">
            <header className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
                {STATUS_LABEL[status]}
              </h3>
              <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-brand-deep">
                {column.length}
              </span>
            </header>

            <div className="space-y-2">
              {column.map((a) => (
                <Link
                  key={a.id}
                  href={`/assignments/${a.id}`}
                  className="block rounded-xl border border-line bg-surface p-3 transition hover:border-brand"
                >
                  <span
                    className="mb-1.5 block h-1 w-8 rounded-full"
                    style={{ background: a.department.color }}
                    aria-hidden="true"
                  />
                  <span className="block text-sm font-semibold leading-snug text-ink">
                    {a.title}
                  </span>
                  <span
                    className={`mt-1.5 block text-[11px] ${
                      isOverdue(a.dueDate, a.status) ? "font-semibold text-danger-strong" : "text-faint"
                    }`}
                  >
                    {relativeDue(a.dueDate)}
                  </span>
                  <span className="mt-2 flex items-center justify-between">
                    <PriorityPill priority={a.priority} />
                    <span className="flex -space-x-1.5">
                      {a.assignees.slice(0, 3).map((x) => (
                        <Avatar
                          key={x.user.id}
                          name={x.user.name}
                          nickname={x.user.nickname}
                          url={x.user.avatarUrl}
                          size={22}
                        />
                      ))}
                    </span>
                  </span>
                </Link>
              ))}

              {column.length === 0 ? (
                <p className="rounded-xl border border-dashed border-edge px-3 py-5 text-center text-xs text-faint">
                  Empty
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function ListView({ items }: { items: AssignmentSummary[] }) {
  if (items.length === 0) {
    return <EmptyState title="No tasks match this filter" />;
  }

  return (
    <>
      {/* A real table on desktop, stacked rows on a phone. */}
      <div className="hs-card hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Task", "Department", "Due", "Priority", "Status", "Assigned"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-faint">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-line-soft last:border-0 hover:bg-tint/40">
                <td className="px-4 py-2.5">
                  <Link href={`/assignments/${a.id}`} className="font-semibold text-ink hover:text-brand-deep">
                    {a.title}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted">{a.department.name}</td>
                <td
                  className={`px-4 py-2.5 ${
                    isOverdue(a.dueDate, a.status) ? "font-semibold text-danger-strong" : "text-muted"
                  }`}
                >
                  {formatDate(a.dueDate)}
                </td>
                <td className="px-4 py-2.5">
                  <PriorityPill priority={a.priority} />
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill status={a.status} />
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex -space-x-1.5">
                    {a.assignees.slice(0, 4).map((x) => (
                      <Avatar
                        key={x.user.id}
                        name={x.user.name}
                        nickname={x.user.nickname}
                        url={x.user.avatarUrl}
                        size={24}
                      />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="hs-card divide-y divide-line-soft p-2 md:hidden">
        {items.map((a) => (
          <AssignmentRow key={a.id} a={a} />
        ))}
      </div>
    </>
  );
}

export type CalendarEventChip = { id: string; day: number; title: string; time: string | null; color: string };

export function CalendarView({
  items,
  month,
  events = [],
  dayHref,
  selectedDay,
}: {
  items: AssignmentSummary[];
  month: Date;
  events?: CalendarEventChip[];
  dayHref?: (day: number, eventId?: string) => string;
  selectedDay?: number;
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Monday-first

  const byDay = new Map<number, AssignmentSummary[]>();
  for (const a of items) {
    if (!a.dueDate) continue;
    if (a.dueDate.getFullYear() !== year || a.dueDate.getMonth() !== monthIndex) continue;
    const day = a.dueDate.getDate();
    byDay.set(day, [...(byDay.get(day) ?? []), a]);
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const today = dayHref ? new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }) + "T12:00:00") : new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() === monthIndex;

  return (
    <div className="hs-card overflow-x-auto p-3">
      <p className="mb-3 text-center text-sm font-bold text-brand-deep">
        {new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(month)}
      </p>

      <div className="grid min-w-[640px] grid-cols-7 gap-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="pb-1 text-center text-[11px] font-bold uppercase text-faint">
            {d}
          </div>
        ))}

        {cells.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} />;
          const dayItems = byDay.get(day) ?? [];
          const dayEvents = events.filter((e) => e.day === day);
          const isToday = isThisMonth && today.getDate() === day;

          return (
            <div
              key={day}
              className={`min-h-[92px] rounded-lg border p-1.5 ${
                isToday || day === selectedDay ? "border-brand bg-tint/60" : "border-line bg-surface"
              }`}
            >
              {dayHref ? (
                <Link href={dayHref(day)} aria-label={`Meetings on day ${day}`}
                  aria-current={day === selectedDay ? "date" : undefined}
                  className="mb-1 inline-flex min-h-7 min-w-7 items-center justify-center rounded text-xs font-bold text-brand-deep hover:bg-tint">
                  {day}
                </Link>
              ) : <p className="mb-1 text-[11px] font-bold text-faint">{day}</p>}
              <div className="space-y-1">
                {dayEvents.map((e) => (
                  <Link
                    key={e.id}
                    href={dayHref ? dayHref(day, e.id) : `#event-${e.id}`}
                    title={e.title}
                    className="block truncate rounded bg-tint px-1.5 py-0.5 text-[11px] font-semibold text-ink"
                  >
                    {e.time ? `${e.time} ` : ""}
                    <span aria-hidden="true" className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: e.color }} />
                    {e.title}
                  </Link>
                ))}
                {dayItems.slice(0, 3).map((a) => (
                  <Link
                    key={a.id}
                    href={`/assignments/${a.id}`}
                    title={a.title}
                    className="block truncate rounded px-1.5 py-0.5 text-[11px] font-medium"
                    style={swatchStyle(a.department.color)}
                  >
                    {a.title}
                  </Link>
                ))}
                {dayItems.length > 3 ? (
                  <p className="px-1 text-[10px] text-faint">+{dayItems.length - 3} more</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
