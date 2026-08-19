'use client';

import { useState, useTransition } from 'react';
import { ASSIGNMENT_STATUS_META, ASSIGNMENT_STATUSES, type AssignmentStatus } from '@/lib/types';
import { isOverdue, type AssignmentRow } from '@/lib/rows';
import { formatDue } from '@/lib/format';
import { setAssignmentStatusAction } from './actions';

/**
 * Kanban board. Drag a card between columns to change its status; the server
 * action is the thing that decides whether the move is allowed, and the card
 * springs back if it is not.
 */
export function Board({
  assignments,
  deptNames,
  canApproveHere,
  onOpen,
}: {
  assignments: AssignmentRow[];
  deptNames: Record<string, string>;
  canApproveHere: boolean;
  onOpen: (id: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function move(id: string, status: AssignmentStatus) {
    setError(null);
    if ((status === 'approved' || status === 'done') && !canApproveHere) {
      setError('Only a department head or above can approve.');
      return;
    }
    start(async () => {
      const res = await setAssignmentStatusAction(id, status);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <>
      {error ? (
        <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-3.5 overflow-x-auto pb-2">
        {ASSIGNMENT_STATUSES.map((key) => {
          const meta = ASSIGNMENT_STATUS_META[key];
          const cards = assignments.filter((a) => a.status === key);

          return (
            <div
              key={key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragging) move(dragging, key);
                setDragging(null);
              }}
              className="w-[248px] shrink-0 rounded-xl border border-line bg-surface-2 p-3"
            >
              <div
                className="mb-3 flex items-center gap-2 border-b-2 pb-2.5"
                style={{ borderColor: meta.color }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                <span className="text-[13px] font-bold">{meta.label}</span>
                <span className="ml-auto text-[12px] font-semibold text-muted">
                  {cards.length}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                {cards.map((c) => {
                  const over = isOverdue(c);
                  return (
                    <article
                      key={c.id}
                      draggable
                      onDragStart={() => setDragging(c.id)}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => onOpen(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpen(c.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      className="cursor-pointer rounded-[11px] border border-line bg-surface p-3 shadow-card transition-shadow hover:shadow-raised"
                    >
                      <div className="mb-2.5 text-[13px] font-semibold">{c.title}</div>
                      <div className="flex items-center gap-2">
                        {c.department_id ? (
                          <span className="rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-[10.5px] font-bold text-deep">
                            {deptNames[c.department_id] ?? 'General'}
                          </span>
                        ) : (
                          <span className="rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-[10.5px] font-bold text-deep">
                            General
                          </span>
                        )}
                        <span
                          className="text-[11px] font-semibold"
                          style={{ color: over ? 'var(--danger)' : 'var(--muted-2)' }}
                        >
                          {formatDue(c.due_date, over)}
                        </span>
                      </div>
                    </article>
                  );
                })}

                {cards.length === 0 ? (
                  <p className="py-4 text-center text-[12px] text-muted">Nothing here</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
