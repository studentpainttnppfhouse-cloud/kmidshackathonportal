'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { PRIORITIES, type Department } from '@/lib/types';
import { createAssignmentAction } from './actions';

export function NewTaskDialog({
  departments,
  people,
  onClose,
  defaultDepartmentId,
}: {
  departments: Department[];
  people: { id: string; label: string }[];
  onClose: () => void;
  defaultDepartmentId?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New task"
        className="fixed left-1/2 top-1/2 z-[51] w-[520px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 animate-fadeup rounded-2xl border border-line bg-surface p-6 shadow-raised"
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">New task</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto text-muted hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <form
          className="flex flex-col gap-3.5"
          action={(fd) => {
            setError(null);
            start(async () => {
              const res = await createAssignmentAction(fd);
              if (res.ok) onClose();
              else setError(res.error);
            });
          }}
        >
          <div>
            <label className="label" htmlFor="title">Title *</label>
            <input id="title" name="title" required maxLength={200} autoFocus className="input"
              placeholder="Confirm sponsor logos for the banner" />
          </div>

          <div>
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" name="description" rows={3} maxLength={4000} className="input resize-y"
              placeholder="What needs to happen, and what does done look like?" />
          </div>

          <div className="grid gap-3.5 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="department_id">Department</label>
              <select id="department_id" name="department_id" className="input"
                defaultValue={defaultDepartmentId ?? ''}>
                <option value="">General</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="due_date">Due date</label>
              <input id="due_date" name="due_date" type="date" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="priority">Priority</label>
              <select id="priority" name="priority" className="input" defaultValue="medium">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p} className="capitalize">{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="assignees">Assign to</label>
            <select id="assignees" name="assignees" multiple size={4} className="input">
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11.5px] text-muted">Hold ⌘ or Ctrl to pick several.</p>
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-1 flex gap-2.5">
            <button type="submit" disabled={pending} className="btn-primary flex-1">
              {pending ? 'Creating…' : 'Create task'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
