"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createAssignment, updateAssignment } from "@/lib/actions/assignments";
import type { FormState } from "@/lib/actions/auth";
import { Feedback, SubmitButton } from "@/components/form-bits";
import { DraftKeeper } from "@/components/draft-keeper";
import { Avatar } from "@/components/ui";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { toDateInput } from "@/lib/dates";
import type { AssignmentStatus, Priority } from "@prisma/client";
import { PeoplePicker, type PickerTeam } from "@/components/people-picker";

const initial: FormState = {};

export type PickerUser = {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl?: string | null;
  departmentId?: string | null;
  roleTitle?: string | null;
};
export type PickerDept = { id: string; name: string };

const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[];

/** Bangkok-local YYYY-MM-DD, `days` from today. What the date input speaks. */
function dateInDays(days: number): string {
  const now = new Date();
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  bangkok.setUTCDate(bangkok.getUTCDate() + days);
  return bangkok.toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  if (!value) return "no date";
  const parsed = new Date(`${value}T12:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return "no date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  }).format(parsed);
}

/**
 * Filing a task, as one screen.
 *
 * The old version was eight stacked fields and a wall of checkboxes, which
 * meant every task — a two-word reminder included — cost the same trip through
 * every setting the model has. This splits the two halves of the job: what the
 * task is goes in the main column, and everything that routes it (team, people,
 * date, priority, status) sits in a panel beside it, the same shape as the
 * navigation the portal already uses.
 *
 * The defaults are chosen so a task can be filed by typing a title and pressing
 * Ctrl+Enter. Nothing else is required.
 */
export function AssignmentForm({
  departments,
  people,
  canAssignOthers,
  canApprove,
  viewerId,
  assignment,
  defaultDepartmentId,
  defaultAssigneeIds = [],
  teams,
}: {
  teams?: PickerTeam[];
  departments: PickerDept[];
  people: PickerUser[];
  canAssignOthers: boolean;
  canApprove: boolean;
  viewerId: string;
  defaultDepartmentId?: string;
  defaultAssigneeIds?: string[];
  assignment?: {
    id: string;
    title: string;
    description: string | null;
    departmentId: string;
    dueDate: Date | null;
    priority: Priority;
    status: AssignmentStatus;
    linkUrl: string | null;
    recurrence: string | null;
    assigneeIds: string[];
  };
}) {
  const [state, action] = useActionState(assignment ? updateAssignment : createAssignment, initial);

  const [departmentId, setDepartmentId] = useState(
    assignment?.departmentId ?? defaultDepartmentId ?? departments[0]?.id ?? "",
  );
  const [due, setDue] = useState(toDateInput(assignment?.dueDate));
  const [assignees, setAssignees] = useState<string[]>(
    assignment ? assignment.assigneeIds : defaultAssigneeIds,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const toggle = (id: string) =>
    setAssignees((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  // Ctrl/Cmd+Enter submits from anywhere in the form, including the textarea —
  // filing five tasks in a row should not mean five trips to the button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        formRef.current?.requestSubmit();
      }
    };
    const form = formRef.current;
    form?.addEventListener("keydown", onKey);
    return () => form?.removeEventListener("keydown", onKey);
  }, []);

  const teamName = departments.find((d) => d.id === departmentId)?.name ?? "No team";

  return (
    <form ref={formRef} action={action} className="hs-composer">
      {assignment ? <input type="hidden" name="id" value={assignment.id} /> : null}

      {/* --- What the task is ------------------------------------------- */}
      <div className="hs-composer-main">
        <label className="sr-only" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={200}
          autoFocus={!assignment}
          defaultValue={assignment?.title ?? ""}
          placeholder="What needs doing?"
          className="hs-composer-title"
        />

        <label className="sr-only" htmlFor="description">
          Details
        </label>
        <textarea
          id="description"
          name="description"
          rows={8}
          defaultValue={assignment?.description ?? ""}
          placeholder="What done looks like, and anything the person taking it needs to know."
          className="hs-composer-notes"
        />

        <details className="hs-disclosure" open={Boolean(assignment?.linkUrl || assignment?.recurrence)}>
          <summary>
            Link and repeats
            <span className="hs-disclosure-note">optional</span>
          </summary>
          <div className="grid gap-4 pt-3 sm:grid-cols-2">
            <div>
              <label className="hs-label" htmlFor="linkUrl">
                Linked document
              </label>
              <input
                id="linkUrl"
                name="linkUrl"
                type="url"
                defaultValue={assignment?.linkUrl ?? ""}
                placeholder="https://docs.google.com/…"
                className="hs-input"
              />
            </div>
            <div>
              <label className="hs-label" htmlFor="recurrence">
                Repeats
              </label>
              <input
                id="recurrence"
                name="recurrence"
                defaultValue={assignment?.recurrence ?? ""}
                placeholder="Every Tuesday"
                className="hs-input"
              />
            </div>
          </div>
        </details>
      </div>

      {/* --- Where it goes ---------------------------------------------- */}
      <aside className="hs-composer-side">
        <div className="hs-panel-block">
          <label className="hs-label" htmlFor="departmentId">
            Team
          </label>
          <select
            id="departmentId"
            name="departmentId"
            required
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="hs-input"
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="hs-panel-block">
          <p className="hs-label">
            Assigned to
            {assignees.length > 0 ? (
              <span className="ml-1.5 font-normal normal-case tracking-normal text-faint">
                {assignees.length} selected
              </span>
            ) : null}
          </p>

          {assignees.map((id) => (
            <input key={id} type="hidden" name="assigneeIds" value={id} />
          ))}

          {canAssignOthers ? (
            <>
              {assignees.length > 0 ? (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                  {assignees.map((id) => {
                    const person = byId.get(id);
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => toggle(id)}
                          className="hs-chip"
                          aria-label={`Remove ${person?.nickname || person?.name || "person"}`}
                        >
                          {person?.nickname || person?.name || "Unknown"}
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="hs-btn hs-btn-secondary w-full justify-center"
              >
                {assignees.length > 0 ? "Change people…" : "Choose people…"}
              </button>
              <PeoplePicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                people={people}
                teams={teams ?? departments}
                selected={assignees}
                onConfirm={setAssignees}
                focusTeamId={departmentId}
              />

              {!assignees.includes(viewerId) && byId.has(viewerId) ? (
                <button
                  type="button"
                  onClick={() => toggle(viewerId)}
                  className="mt-2 text-xs font-semibold text-brand-deep hover:underline"
                >
                  Assign it to me
                </button>
              ) : null}
            </>
          ) : (
            <p className="rounded-[10px] bg-tint px-3 py-2.5 text-sm text-muted">
              Members file tasks for themselves. Ask your head to move it to somebody else.
            </p>
          )}
        </div>

        <div className="hs-panel-block">
          <label className="hs-label" htmlFor="dueDate">
            Due
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[
              { label: "Today", value: dateInDays(0) },
              { label: "Tomorrow", value: dateInDays(1) },
              { label: "Next week", value: dateInDays(7) },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setDue(due === option.value ? "" : option.value)}
                aria-pressed={due === option.value}
                className="hs-chip-toggle"
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            id="dueDate"
            name="dueDate"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="hs-input"
          />
        </div>

        <fieldset className="hs-panel-block">
          <legend className="hs-label">Priority</legend>
          <div className="hs-seg">
            {PRIORITIES.map((p) => (
              <label key={p} className="hs-seg-option">
                <input
                  type="radio"
                  name="priority"
                  value={p}
                  defaultChecked={(assignment?.priority ?? "MEDIUM") === p}
                />
                <span>{PRIORITY_LABEL[p]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="hs-panel-block">
          <legend className="hs-label">Status</legend>
          <div className="hs-seg hs-seg-stack">
            {STATUS_ORDER.map((s) => {
              const locked = !canApprove && (s === "APPROVED" || s === "DONE");
              return (
                <label key={s} className="hs-seg-option" data-locked={locked ? "1" : undefined}>
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    disabled={locked}
                    defaultChecked={(assignment?.status ?? "NOT_STARTED") === s}
                  />
                  <span>
                    {STATUS_LABEL[s]}
                    {locked ? " · head only" : ""}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </aside>

      <div className="hs-composer-feedback">
        <DraftKeeper formKey={assignment ? `assignment:${assignment.id}` : "assignment:new"} />
        <Feedback state={state} />
      </div>
      {/* --- Commit ------------------------------------------------------ */}
      <div className="hs-composer-bar">
        <p className="min-w-0 flex-1 truncate text-xs text-muted">
          {teamName} · due {shortDate(due)} ·{" "}
          {assignees.length === 0
            ? "nobody assigned yet"
            : `${assignees.length} ${assignees.length === 1 ? "person" : "people"}`}
        </p>
        <span className="hidden text-[11px] text-faint sm:inline">Ctrl + Enter</span>
        <SubmitButton className="hs-btn hs-btn-primary" pendingLabel="Saving…">
          {assignment ? "Save changes" : "Create task"}
        </SubmitButton>
      </div>

    </form>
  );
}
