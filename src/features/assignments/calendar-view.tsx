'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ASSIGNMENT_STATUS_META } from '@/lib/types';
import type { AssignmentRow } from '@/lib/rows';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Month grid. Event days (20–21 March 2027) are tinted. */
export function CalendarView({
  assignments,
  onOpen,
  initialMonth = new Date(2027, 2, 1),
}: {
  assignments: AssignmentRow[];
  onOpen: (id: string) => void;
  initialMonth?: Date;
}) {
  const [cursor, setCursor] = useState(initialMonth);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    if (!a.due_date) continue;
    byDay.set(a.due_date, [...(byDay.get(a.due_date) ?? []), a]);
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-3.5 flex items-center gap-2">
        <h2 className="text-[15px] font-bold">{monthLabel}</h2>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface-2"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface-2"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-[11px] font-bold text-muted-2">
        {WEEKDAYS.map((d) => (
          <div key={d} className="p-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border-l border-t border-line">
        {cells.map((day, i) => {
          if (day === null) {
            return (
              <div
                key={`blank-${i}`}
                className="min-h-[92px] border-b border-r border-line bg-surface p-1.5"
              />
            );
          }

          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isEventDay = iso === '2027-03-20' || iso === '2027-03-21';
          const items = byDay.get(iso) ?? [];

          return (
            <div
              key={iso}
              className="min-h-[92px] border-b border-r border-line p-1.5"
              style={{ background: isEventDay ? 'var(--surface-3)' : 'var(--surface)' }}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className="text-[12px]"
                  style={{
                    fontWeight: isEventDay ? 800 : 600,
                    color: isEventDay ? 'var(--deep)' : 'var(--text)',
                  }}
                >
                  {day}
                </span>
                {isEventDay ? (
                  <span className="mono-tag text-[8px] text-deep">EVENT</span>
                ) : null}
              </div>

              {items.slice(0, 3).map((a) => {
                const meta = ASSIGNMENT_STATUS_META[a.status];
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onOpen(a.id)}
                    title={a.title}
                    className="mt-1 block w-full truncate rounded-[5px] px-1.5 py-0.5 text-left text-[10px] font-semibold text-white"
                    style={{ background: meta.color }}
                  >
                    {a.title}
                  </button>
                );
              })}
              {items.length > 3 ? (
                <div className="mt-1 text-[10px] font-semibold text-muted-2">
                  +{items.length - 3} more
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
