"use client";
import Link from "next/link";
import { useState } from "react";
export type CalendarCard = {
  id: string;
  title: string;
  date: string;
  time: string;
  href: string;
  kind: string;
  mine: boolean;
  team: string;
};
export function WorkspaceCalendar({
  items,
  today,
  canCreate,
}: {
  items: CalendarCard[];
  today: string;
  canCreate: boolean;
}) {
  const [date, setDate] = useState(today);
  const [view, setView] = useState("month");
  const [filter, setFilter] = useState("all");
  const [team, setTeam] = useState("");
  const [year, month, day] = date.split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const move = (step: number) => {
    const d = new Date(current);
    if (view === "year") d.setUTCFullYear(year + step);
    else if (view === "month") {
      d.setUTCDate(1);
      d.setUTCMonth(month - 1 + step);
    } else d.setUTCDate(day + step * (view === "week" ? 7 : 1));
    setDate(key(d));
  };
  const visible = items.filter(
    (i) =>
      (filter === "all" || (filter === "mine" ? i.mine : i.kind === filter)) &&
      (!team || i.team === team),
  );
  const start = new Date(Date.UTC(year, month - 1, view === "month" ? 1 : day));
  if (view === "week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const length =
    view === "month"
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : view === "week"
        ? 7
        : 1;
  const cells = Array.from({ length }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return key(d);
  });
  const label = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(current);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="hs-btn hs-btn-secondary"
          onClick={() => move(-1)}
          aria-label="Previous period"
        >
          ←
        </button>
        <button
          className="hs-btn hs-btn-secondary"
          onClick={() => {
            setDate(today);
          }}
        >
          Today
        </button>
        <button
          className="hs-btn hs-btn-secondary"
          onClick={() => move(1)}
          aria-label="Next period"
        >
          →
        </button>
        <label className="hs-label mb-0">
          Jump to month
          <input
            aria-label="Jump to month"
            type="month"
            className="hs-input"
            value={date.slice(0, 7)}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value + "-01");
            }}
          />
        </label>
        <label className="hs-label mb-0">
          View
          <select
            className="hs-input"
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            <option value="year">Year</option>
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="day">Day</option>
          </select>
        </label>
        <label className="hs-label mb-0">
          Show
          <select
            className="hs-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All visible items</option>
            <option value="mine">My calendar</option>
            <option value="task">Assignments</option>
            <option value="post">Instagram posts</option>
            <option value="event">Events</option>
          </select>
        </label>
        <label className="hs-label mb-0">
          Team
          <select
            className="hs-input"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">All teams</option>
            {[...new Set(items.map((i) => i.team).filter(Boolean))]
              .sort()
              .map((t) => (
                <option key={t}>{t}</option>
              ))}
          </select>
        </label>
      </div>
      <h2 className="hs-h2">
        {view === "year" ? year : view === "day" ? date : label}
      </h2>
      {view === "year" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 12 }, (_, i) => {
            const m = `${year}-${String(i + 1).padStart(2, "0")}`;
            return (
              <button
                key={m}
                className="hs-card p-5 text-left"
                onClick={() => {
                  setDate(m + "-01");
                  setView("month");
                }}
              >
                <strong>
                  {new Intl.DateTimeFormat("en", {
                    month: "long",
                    timeZone: "UTC",
                  }).format(new Date(m + "-01T12:00:00Z"))}
                </strong>
                <p className="text-sm text-muted">
                  {visible.filter((x) => x.date.startsWith(m)).length} items
                </p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="overflow-auto">
          <div
            className={`grid gap-px rounded-xl border border-line bg-line ${view !== "day" ? "min-w-[700px] grid-cols-7" : ""}`}
          >
            {view !== "day"
              ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="bg-surface p-2 text-xs font-bold">
                    {d}
                  </div>
                ))
              : null}
            {view === "month"
              ? Array.from({ length: (start.getUTCDay() + 6) % 7 }, (_, i) => (
                  <div key={"blank" + i} className="bg-surface/50" />
                ))
              : null}
            {cells.map((d) => (
              <section
                key={d}
                className={`min-h-32 space-y-2 bg-surface p-2 ${d === today ? "ring-2 ring-inset ring-brand" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <button
                    className="font-semibold"
                    aria-label={"Open " + d}
                    onClick={() => {
                      setDate(d);
                      setView("day");
                    }}
                  >
                    {Number(d.slice(-2))}
                  </button>
                  {canCreate ? (
                    <Link
                      aria-label={"Add event on " + d}
                      href={"/calendar/new?date=" + d}
                      className="text-brand-deep"
                    >
                      ＋
                    </Link>
                  ) : null}
                </div>
                {visible
                  .filter((i) => i.date === d)
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((i) => (
                    <Link
                      key={i.id}
                      href={i.href}
                      className="block rounded-lg bg-tint p-2 text-xs hover:underline"
                    >
                      <span className="block text-faint">
                        {i.kind === "task" ? "Due" : i.time} · {i.kind}
                      </span>
                      {i.title}
                    </Link>
                  ))}
                {view === "day" && !visible.some((i) => i.date === d) ? (
                  <p className="text-sm text-muted">No items on this date.</p>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted">
        Times are in Bangkok. Click a date to zoom in, or an item to read it.
        Meetings have their own page.
      </p>
    </div>
  );
}
