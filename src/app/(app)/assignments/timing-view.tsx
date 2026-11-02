import Link from "next/link";
import { EmptyState, StatusPill } from "@/components/ui";
import type { AssignmentSummary } from "@/components/assignment-row";
import { isOverdue, relativeDue } from "@/lib/dates";

/** Timing buckets, in the order an Owner or Admin wants to scan them. */
export const TIMING_BUCKETS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "week", label: "Next 7 days" },
  { key: "month", label: "Next 30 days" },
  { key: "later", label: "Later" },
  { key: "none", label: "No due date" },
  { key: "closed", label: "Done / approved" },
] as const;

export type TimingKey = (typeof TIMING_BUCKETS)[number]["key"];

const DAY = 24 * 60 * 60 * 1000;

export function timingOf(a: Pick<AssignmentSummary, "dueDate" | "status">, now = new Date()): TimingKey {
  if (a.status === "DONE" || a.status === "APPROVED") return "closed";
  if (!a.dueDate) return "none";
  if (isOverdue(a.dueDate, a.status)) return "overdue";
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = a.dueDate.getTime();
  if (due < start + DAY) return "today";
  if (due < start + 8 * DAY) return "week";
  if (due < start + 31 * DAY) return "month";
  return "later";
}

/**
 * Every task across every team, grouped by timing and then by team, with a
 * team x timing summary on top. Built for the Owner and Admins.
 */
export function TimingView({ items }: { items: AssignmentSummary[] }) {
  if (items.length === 0) return <EmptyState title="No tasks match this filter" />;

  const now = new Date();
  const teams = new Map<string, { name: string; color: string }>();
  const grid = new Map<TimingKey, Map<string, AssignmentSummary[]>>();
  for (const a of items) {
    teams.set(a.department.slug, { name: a.department.name, color: a.department.color });
    const t = timingOf(a, now);
    const inner = grid.get(t) ?? new Map<string, AssignmentSummary[]>();
    inner.set(a.department.slug, [...(inner.get(a.department.slug) ?? []), a]);
    grid.set(t, inner);
  }
  const teamSlugs = [...teams.keys()];

  return (
    <div className="space-y-6">
      <div className="hs-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-faint">Team</th>
              {TIMING_BUCKETS.map((b) => (
                <th key={b.key} className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-faint">
                  {b.label}
                </th>
              ))}
              <th className="px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-faint">Total</th>
            </tr>
          </thead>
          <tbody>
            {teamSlugs.map((slug) => {
              const team = teams.get(slug)!;
              const total = items.filter((a) => a.department.slug === slug).length;
              return (
                <tr key={slug} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-ink">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: team.color }} aria-hidden="true" />
                    {team.name}
                  </td>
                  {TIMING_BUCKETS.map((b) => {
                    const n = grid.get(b.key)?.get(slug)?.length ?? 0;
                    return (
                      <td
                        key={b.key}
                        className={`px-3 py-2.5 text-center ${
                          n === 0 ? "text-faint" : b.key === "overdue" ? "font-bold text-danger-strong" : "font-bold text-ink"
                        }`}
                      >
                        {n}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-center font-bold text-ink">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {TIMING_BUCKETS.map((b) => {
        const inner = grid.get(b.key);
        if (!inner) return null;
        const count = [...inner.values()].reduce((s, l) => s + l.length, 0);
        return (
          <section key={b.key}>
            <h3 className={`mb-2 text-sm font-bold ${b.key === "overdue" ? "text-danger-strong" : "text-ink"}`}>
              {b.label} <span className="font-semibold text-muted">· {count}</span>
            </h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {teamSlugs
                .filter((slug) => inner.has(slug))
                .map((slug) => (
                  <div key={slug} className="hs-card p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                      {teams.get(slug)!.name} · {inner.get(slug)!.length}
                    </p>
                    <ul className="space-y-1">
                      {inner.get(slug)!.map((a) => (
                        <li key={a.id}>
                          <Link
                            href={`/assignments/${a.id}`}
                            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-tint/40"
                          >
                            <span className="flex-1 truncate text-sm font-semibold text-ink">{a.title}</span>
                            <StatusPill status={a.status} />
                            <span
                              className={`whitespace-nowrap text-[11px] ${
                                isOverdue(a.dueDate, a.status) ? "font-semibold text-danger-strong" : "text-faint"
                              }`}
                            >
                              {relativeDue(a.dueDate)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
