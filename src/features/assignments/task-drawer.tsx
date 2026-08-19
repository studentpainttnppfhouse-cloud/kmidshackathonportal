'use client';

import { useEffect, useState, useTransition } from 'react';
import { X, Send, Trash2, Check } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { ASSIGNMENT_STATUS_META, ASSIGNMENT_STATUSES } from '@/lib/types';
import { isOverdue, type AssignmentRow } from '@/lib/rows';
import { formatDue, relativeTime } from '@/lib/format';
import { addCommentAction, deleteAssignmentAction, setAssignmentStatusAction } from './actions';

export interface DrawerComment {
  id: string;
  body: string;
  created_at: string;
  author: string;
}

export function TaskDrawer({
  task,
  comments,
  deptName,
  canApprove,
  canEdit,
  onClose,
}: {
  task: AssignmentRow;
  comments: DrawerComment[];
  deptName: string;
  canApprove: boolean;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Escape closes the drawer, as it should everywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = ASSIGNMENT_STATUS_META[task.status];
  const over = isOverdue(task);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="fixed inset-y-0 right-0 z-[51] flex h-screen w-[420px] max-w-[92vw] animate-fadeup-fast flex-col border-l border-line bg-surface shadow-drawer"
      >
        <header className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <span className="rounded-md bg-surface-3 px-2.5 py-1 text-[11px] font-bold text-deep">
            {deptName}
          </span>
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{
              color: meta.color,
              background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
            }}
          >
            {meta.label}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto text-xl text-muted hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <h2 className="mb-3.5 text-[19px] font-extrabold tracking-[-0.01em]">{task.title}</h2>

          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px]">
            <dt className="text-muted-2">Assignee</dt>
            <dd className="font-semibold">
              {task.assignees.length === 0
                ? 'Unassigned'
                : task.assignees.map((a) => a.nickname ?? a.name ?? 'Staff').join(', ')}
            </dd>
            <dt className="text-muted-2">Due</dt>
            <dd className="font-semibold" style={{ color: over ? 'var(--danger)' : undefined }}>
              {formatDue(task.due_date, over)}
            </dd>
            <dt className="text-muted-2">Priority</dt>
            <dd className="font-semibold capitalize">{task.priority}</dd>
          </dl>

          {task.description ? (
            <p className="mb-4 whitespace-pre-wrap text-[13px] leading-relaxed">
              {task.description}
            </p>
          ) : null}

          {canEdit ? (
            <div className="mb-5">
              <div className="label">Move to</div>
              <div className="flex flex-wrap gap-1.5">
                {ASSIGNMENT_STATUSES.map((s) => {
                  const sm = ASSIGNMENT_STATUS_META[s];
                  const locked = (s === 'approved' || s === 'done') && !canApprove;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={pending || locked || s === task.status}
                      title={locked ? 'Only a department head or above can approve' : undefined}
                      onClick={() => run(() => setAssignmentStatusAction(task.id, s))}
                      className="rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40"
                      style={{
                        borderColor: s === task.status ? sm.color : 'var(--border-2)',
                        color: s === task.status ? '#fff' : sm.color,
                        background: s === task.status ? sm.color : 'transparent',
                      }}
                    >
                      {s === task.status ? <Check size={11} className="inline" /> : null} {sm.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <h3 className="mb-3 text-[13px] font-bold">Comments</h3>
          {comments.length === 0 ? (
            <p className="text-[13px] text-muted-2">No comments yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <Avatar name={c.author} size={30} />
                  <div className="min-w-0">
                    <div className="rounded-[10px] bg-surface-2 px-3 py-2 text-[13px]">
                      {c.body}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {c.author} · {relativeTime(c.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm('Move this task to the recycle bin?')) {
                  run(async () => {
                    const r = await deleteAssignmentAction(task.id);
                    if (r.ok) onClose();
                    return r;
                  });
                }
              }}
              className="mt-6 flex items-center gap-1.5 text-[12.5px] font-semibold text-danger"
            >
              <Trash2 size={13} /> Delete task
            </button>
          ) : null}
        </div>

        <form
          className="flex gap-2 border-t border-line px-5 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            const body = comment;
            setComment('');
            run(() => addCommentAction('assignment', task.id, body));
          }}
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="input flex-1"
          />
          <button type="submit" disabled={pending || !comment.trim()} className="btn-primary px-4">
            <Send size={15} />
            <span className="sr-only">Send</span>
          </button>
        </form>
      </aside>
    </>
  );
}
