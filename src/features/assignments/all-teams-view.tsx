'use client';

import { useMemo } from 'react';
import { ASSIGNMENT_STATUS_META } from '@/lib/types';
import { asIsoDate, isOverdue, todayIso, type AssignmentRow } from '@/lib/rows';
import { formatDue } from '@/lib/format';

/** Timing buckets, in the order an Owner or Admin wants to scan them. */
export const TIMING_BUCKETS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'month', label: 'Next 30 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
  { key: 'closed', label: 'Done / approved' },
] as const;

export type TimingKey = (typeof TIMING_BUCKETS)[number]['key'];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function timingOf(a: AssignmentRow, today = todayIso()): TimingKey {
  if (a.status === 'done' || a.status === 'approved') return 'closed';
  const due = asIsoDate(a.due_date);
  if (!due) return 'none';
  if (isOverdue(a)) return 'overdue';
  if (due === today) return 'today';
  if (due <= addDays(today, 7)) return 'week';
  if (due <= addDays(today, 30)) return 'month';
  return 'later';
}

/**
 * Every assignment across every team, grouped first by timing and then by
 * team (category), so nothing is hidden behind a single department's board.
 */
export function AllTeamsView({
  assignments,
  deptNames,
  deptOrder,
  onOpen,
}: {
  assignments: AssignmentRow[];
  deptNames: Record<string, string>;
  deptOrder: string[];
  onOpen: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const today = todayIso();
    const byTiming = new Map<TimingKey, Map<string, AssignmentRow[]>>();
    for (const a of assignments) {
      const t = timingOf(a, today);
      const dept = a.department_id ?? 'general';
      const inner = byTiming.get(t) ?? new Map<string, AssignmentRow[]>();
      inner.set(dept, [...(inner.get(dept) ?? []), a]);
      byTiming.set(t, inner);
    }
    return byTiming;
  }, [assignments]);

  const order = [...deptOrder, 'general'];
  const name = (id: string) => (id === 'general' ? 'General' : deptNames[id] ?? 'General');

  // Team x timing totals, so the Owner sees the whole portal at a glance.
  const teamIds = order.filter((id) =>
    assignments.some((a) => (a.department_id ?? 'general') === id),
  );

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-surface-2 text-[11px] uppercase tracking-[0.03em] text-muted-2">
              <th className="p-2.5 pl-4 text-left font-bold">Team</th>
              {TIMING_BUCKETS.map((b) => (
                <th key={b.key} className="p-2.5 text-center font-bold">
                  {b.label}
                </th>
              ))}
              <th className="p-2.5 text-center font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {teamIds.map((id) => {
              const total = assignments.filter((a) => (a.department_id ?? 'general') === id).length;
              return (
                <tr key={id} className="border-t border-line">
                  <td className="p-2.5 pl-4 font-semibold">{name(id)}</td>
                  {TIMING_BUCKETS.map((b) => {
                    const n = grouped.get(b.key)?.get(id)?.length ?? 0;
                    return (
                      <td
                        key={b.key}
                        className="p-2.5 text-center"
                        style={{
                          color: n === 0 ? 'var(--muted)' : b.key === 'overdue' ? 'var(--danger)' : undefined,
                          fontWeight: n ? 700 : 400,
                        }}
                      >
                        {n}
                      </td>
                    );
                  })}
                  <td className="p-2.5 text-center font-bold">{total}</td>
                </tr>
              );
            })}
            {teamIds.length === 0 ? (
              <tr>
                <td colSpan={TIMING_BUCKETS.length + 2} className="p-8 text-center text-muted-2">
                  No tasks in the portal yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {TIMING_BUCKETS.map((b) => {
        const inner = grouped.get(b.key);
        if (!inner) return null;
        const count = [...inner.values()].reduce((s, l) => s + l.length, 0);
        return (
          <section key={b.key}>
            <h3
              className="mb-2 text-[13px] font-bold"
              style={{ color: b.key === 'overdue' ? 'var(--danger)' : undefined }}
            >
              {b.label} <span className="font-semibold text-muted-2">· {count}</span>
            </h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {order
                .filter((id) => inner.has(id))
                .map((id) => (
                  <div key={id} className="rounded-xl border border-line bg-surface p-3 shadow-card">
                    <div className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted-2">
                      {name(id)} · {inner.get(id)!.length}
                    </div>
                    <ul className="space-y-1">
                      {inner.get(id)!.map((a) => {
                        const meta = ASSIGNMENT_STATUS_META[a.status];
                        const over = isOverdue(a);
                        return (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => onOpen(a.id)}
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                            >
                              <span className="flex-1 truncate text-[13px] font-semibold">{a.title}</span>
                              <span className="text-[11px] font-bold" style={{ color: meta.color }}>
                                {meta.label}
                              </span>
                              <span
                                className="whitespace-nowrap text-[11.5px]"
                                style={{ color: over ? 'var(--danger)' : 'var(--muted-2)' }}
                              >
                                {formatDue(a.due_date, over)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
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
