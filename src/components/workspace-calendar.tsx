"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type CalendarCard = {
  id: string;
  title: string;
  date: string;
  time: string;
  href: string;
  kind: string;
  mine: boolean;
  team: string;
  teamId: string;
  color: string;
  assignees: { id: string; name: string }[];
};
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const key = (date: Date) => date.toISOString().slice(0, 10);
const monthName = (date: Date) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
    date,
  );
const typeNames: Record<string, string> = {
  task: "Assignment due",
  post: "Social media post",
  event: "Event",
};

export function WorkspaceCalendar({
  items,
  today,
  canCreate,
  departments,
  staff,
  initialTeam = "",
}: {
  items: CalendarCard[];
  today: string;
  canCreate: boolean;
  initialTeam?: string;
  departments: { id: string; name: string }[];
  staff: { id: string; name: string; departmentId: string | null }[];
}) {
  const [date, setDate] = useState(today);
  const [view, setView] = useState("month");
  const [filter, setFilter] = useState("all");
  const [team, setTeam] = useState(initialTeam);
  const [person, setPerson] = useState("");
  const [jumpOpen, setJumpOpen] = useState(false);
  const [year, month, day] = date.split("-").map(Number);
  const current = new Date(`${date}T12:00:00Z`);
  function move(step: number) {
    const next = new Date(current);
    if (view === "year") {
      next.setUTCDate(1);
      next.setUTCFullYear(year + step);
    } else if (view === "month") {
      next.setUTCDate(1);
      next.setUTCMonth(month - 1 + step);
    } else next.setUTCDate(day + step * (view === "week" ? 7 : 1));
    setDate(key(next));
  }
  const teams = departments;
  const people = useMemo(
    () => staff.filter((person) => !team || person.departmentId === team),
    [staff, team],
  );
  const visible = items.filter(
    (item) =>
      (filter === "all" ||
        (filter === "mine" ? item.mine : item.kind === filter)) &&
      (!team || item.teamId === team) &&
      (!person || item.assignees.some((assigned) => assigned.id === person)),
  );
  const byDay = new Map<string, CalendarCard[]>();
  for (const item of visible)
    byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  const start = new Date(Date.UTC(year, month - 1, view === "month" ? 1 : day));
  if (view === "week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const days =
    view === "month"
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : view === "week"
        ? 7
        : 1;
  const cells = Array.from({ length: days }, (_, index) => {
    const cursor = new Date(start);
    cursor.setUTCDate(start.getUTCDate() + index);
    return key(cursor);
  });
  const leading = view === "month" ? (start.getUTCDay() + 6) % 7 : 0;
  const trailing = view === "month" ? (7 - ((leading + days) % 7)) % 7 : 0;
  const label =
    view === "year"
      ? String(year)
      : view === "day"
        ? new Intl.DateTimeFormat("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(current)
        : `${monthName(current)} ${year}`;

  function openDay(value: string) {
    setDate(value);
    setView("day");
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-4">
        <button
          type="button"
          className="hs-btn hs-btn-secondary"
          onClick={() => move(-1)}
          aria-label="Previous period"
        >
          ←
        </button>
        <button
          type="button"
          className="hs-btn hs-btn-secondary"
          onClick={() => setDate(today)}
        >
          Today
        </button>
        <button
          type="button"
          className="hs-btn hs-btn-secondary"
          onClick={() => move(1)}
          aria-label="Next period"
        >
          →
        </button>
        <button
          type="button"
          onClick={() => setJumpOpen(!jumpOpen)}
          aria-expanded={jumpOpen}
          aria-controls="calendar-jump"
          className="ml-1 rounded-md px-2 py-2 text-lg font-bold text-ink hover:bg-tint"
        >
          {label} ▾
        </button>
        <div className="flex-1" />
        <label className="text-sm font-semibold">
          View
          <select
            aria-label="Calendar view"
            className="hs-input"
            value={view}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="day">Day</option>
            <option value="year">Year</option>
          </select>
        </label>
      </div>
      {jumpOpen ? (
        <div
          id="calendar-jump"
          className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3"
        >
          <label className="hs-label mb-0">
            Jump to month
            <input
              aria-label="Jump to month"
              type="month"
              className="hs-input"
              value={date.slice(0, 7)}
              onChange={(event) => {
                if (/^\d{4}-\d{2}$/.test(event.target.value)) {
                  setDate(`${event.target.value}-01`);
                  setView("month");
                }
              }}
            />
          </label>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={() => {
              setView("year");
              setJumpOpen(false);
            }}
          >
            See all of {year}
          </button>
          <button
            type="button"
            className="hs-btn hs-btn-ghost"
            onClick={() => setJumpOpen(false)}
          >
            Done
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="hs-label mb-0">
          Show
          <select
            className="hs-input"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All schedules</option>
            <option value="mine">Assigned to me</option>
            <option value="task">Assignments</option>
            <option value="post">Social media posts</option>
            <option value="event">Events</option>
          </select>
        </label>
        <label className="hs-label mb-0">
          Department
          <select
            className="hs-input"
            value={team}
            onChange={(event) => {
              setTeam(event.target.value);
              setPerson("");
            }}
          >
            <option value="">All departments</option>
            {teams.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="hs-label mb-0">
          Person
          <select
            className="hs-input"
            value={person}
            onChange={(event) => setPerson(event.target.value)}
          >
            <option value="">Everyone</option>
            {people.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </select>
        </label>
        <span className="pb-2 text-xs text-muted">Bangkok time</span>
        {view === "day" && canCreate ? (
          <Link
            className="hs-btn hs-btn-primary ml-auto"
            href={`/calendar/new?date=${date}`}
          >
            + Add on this date
          </Link>
        ) : null}
      </div>
      {view === "year" ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 12 }, (_, index) => {
            const monthKey = `${year}-${String(index + 1).padStart(2, "0")}`;
            const first = new Date(`${monthKey}-01T12:00:00Z`);
            return (
              <section
                key={monthKey}
                className="rounded-lg border border-line bg-surface p-4"
              >
                <button
                  type="button"
                  className="mb-3 text-sm font-bold text-brand-deep hover:underline"
                  onClick={() => {
                    setDate(`${monthKey}-01`);
                    setView("month");
                  }}
                >
                  {monthName(first)}
                </button>
                <div className="grid grid-cols-7 gap-1 text-center text-xs">
                  {weekdays.map((weekday) => (
                    <span key={weekday} className="py-1 text-muted">
                      {weekday.slice(0, 1)}
                    </span>
                  ))}
                  {Array.from(
                    { length: (first.getUTCDay() + 6) % 7 },
                    (_, blank) => (
                      <span key={`blank-${blank}`} />
                    ),
                  )}
                  {Array.from(
                    {
                      length: new Date(
                        Date.UTC(year, index + 1, 0),
                      ).getUTCDate(),
                    },
                    (_, cursor) => {
                      const value = `${monthKey}-${String(cursor + 1).padStart(2, "0")}`;
                      const count = byDay.get(value)?.length ?? 0;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-label={`${value}, ${count} scheduled items`}
                          onClick={() => openDay(value)}
                          className={`relative min-h-8 rounded-md py-1 hover:bg-tint ${value === today ? "bg-brand text-white" : "text-ink"}`}
                        >
                          {cursor + 1}
                          {count ? (
                            <span
                              aria-hidden="true"
                              className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current"
                            />
                          ) : null}
                        </button>
                      );
                    },
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <div
            className={`grid gap-px bg-line ${view !== "day" ? "min-w-[700px] grid-cols-7" : ""}`}
          >
            {view !== "day"
              ? weekdays.map((weekday) => (
                  <div
                    key={weekday}
                    className="bg-surface-2 p-2 text-xs font-semibold text-muted"
                  >
                    {weekday}
                  </div>
                ))
              : null}
            {Array.from({ length: leading }, (_, index) => (
              <div key={`before-${index}`} className="bg-surface-2" />
            ))}
            {cells.map((value) => {
              const entries = (byDay.get(value) ?? [])
                .slice()
                .sort((a, b) => a.time.localeCompare(b.time));
              const shown = view === "month" ? entries.slice(0, 3) : entries;
              return (
                <section
                  key={value}
                  className={`min-h-36 space-y-2 bg-surface p-2 ${value === today ? "ring-2 ring-inset ring-brand" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      className="min-h-8 min-w-8 rounded-md text-sm font-semibold hover:bg-tint"
                      aria-label={`Open ${value}`}
                      onClick={() => openDay(value)}
                    >
                      {view === "week"
                        ? `${weekdays[(new Date(value).getUTCDay() + 6) % 7]} `
                        : ""}
                      {Number(value.slice(-2))}
                    </button>
                    {canCreate ? (
                      <Link
                        aria-label={`Add event on ${value}`}
                        href={`/calendar/new?date=${value}`}
                        className="grid h-8 w-8 place-items-center rounded text-brand-deep hover:bg-tint"
                      >
                        +
                      </Link>
                    ) : null}
                  </div>
                  {shown.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="block space-y-1 rounded-md bg-tint/60 p-2 text-xs hover:bg-tint"
                    >
                      <span className="flex items-center gap-1 text-muted">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: item.color }}
                        />
                        {item.kind === "task" ? "Due" : item.time} ·{" "}
                        {typeNames[item.kind] ?? "Event"}
                      </span>
                      <span className="block font-semibold text-ink">
                        {item.title}
                      </span>
                      <span
                        className="block truncate text-muted"
                        title={item.assignees
                          .map((staff) => staff.name)
                          .join(", ")}
                      >
                        {item.assignees.length
                          ? item.assignees.map((staff) => staff.name).join(", ")
                          : item.team || "Unassigned"}
                      </span>
                      {view === "day" && item.team ? (
                        <span className="block text-muted">{item.team}</span>
                      ) : null}
                    </Link>
                  ))}
                  {entries.length > shown.length ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-brand-deep"
                      onClick={() => openDay(value)}
                    >
                      +{entries.length - shown.length} more
                    </button>
                  ) : null}
                  {view === "day" && !entries.length ? (
                    <p className="p-4 text-sm text-muted">
                      No scheduled items on this date.
                    </p>
                  ) : null}
                </section>
              );
            })}
            {Array.from({ length: trailing }, (_, index) => (
              <div key={`after-${index}`} className="bg-surface-2" />
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted">
        Select a date to see its schedule. Open an assignment or event to adjust
        its dates and people.
      </p>
    </div>
  );
}
