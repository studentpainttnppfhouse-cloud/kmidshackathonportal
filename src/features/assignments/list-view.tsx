'use client';

import { useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { ASSIGNMENT_STATUS_META } from '@/lib/types';
import { isOverdue, type AssignmentRow } from '@/lib/rows';
import { formatDue } from '@/lib/format';
import { Avatar } from '@/components/avatar';

type SortKey = 'title' | 'status' | 'due_date';

export function ListView({
  assignments,
  deptNames,
  onOpen,
}: {
  assignments: AssignmentRow[];
  deptNames: Record<string, string>;
  onOpen: (id: string) => void;
}) {
  const [sort, setSort] = useState<SortKey>('due_date');
  const [asc, setAsc] = useState(true);

  const rows = useMemo(() => {
    const copy = [...assignments];
    copy.sort((a, b) => {
      const av = a[sort] ?? '';
      const bv = b[sort] ?? '';
      // Rows with no due date belong at the end regardless of direction.
      if (sort === 'due_date') {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
      }
      return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [assignments, sort, asc]);

  function header(key: SortKey, label: string) {
    return (
      <th className="p-3 text-left font-bold first:pl-4">
        <button
          type="button"
          onClick={() => {
            if (sort === key) setAsc((v) => !v);
            else {
              setSort(key);
              setAsc(true);
            }
          }}
          className="inline-flex items-center gap-1 text-[11.5px] uppercase tracking-[0.03em] text-muted-2 hover:text-ink"
        >
          {label}
          <ArrowUpDown size={11} />
        </button>
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-surface-2">
            {header('title', 'Task')}
            <th className="p-3 text-left text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted-2">
              Dept
            </th>
            {header('status', 'Status')}
            {header('due_date', 'Due')}
            <th className="p-3 text-left text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted-2">
              Owner
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const meta = ASSIGNMENT_STATUS_META[r.status];
            const over = isOverdue(r);
            const owner = r.assignees[0];
            return (
              <tr
                key={r.id}
                onClick={() => onOpen(r.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
                className="cursor-pointer border-t border-line hover:bg-surface-2"
              >
                <td className="p-3 pl-4 font-semibold">{r.title}</td>
                <td className="p-3 text-muted-2">
                  {r.department_id ? deptNames[r.department_id] ?? 'General' : 'General'}
                </td>
                <td className="p-3">
                  <span
                    className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                    style={{
                      color: meta.color,
                      background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
                    }}
                  >
                    {meta.label}
                  </span>
                </td>
                <td className="p-3">
                  <span
                    className="text-[12px] font-semibold"
                    style={{ color: over ? 'var(--danger)' : 'var(--muted-2)' }}
                  >
                    {formatDue(r.due_date, over)}
                  </span>
                </td>
                <td className="p-3">
                  {owner ? (
                    <Avatar name={owner.nickname ?? owner.name} size={26} />
                  ) : (
                    <span className="text-[12px] text-muted">Unassigned</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-8 text-center text-[13px] text-muted-2">
                No tasks match this view.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
