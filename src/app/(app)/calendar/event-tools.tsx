"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { Feedback, SubmitButton } from "@/components/form-bits";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/actions/calendar";
import type { FormState } from "@/lib/actions/auth";

type MeetingDraft = {
  id: string;
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  departmentId: string | null;
  location: string | null;
  notes: string | null;
  slidesUrl: string | null;
  summary: string | null;
  nextSteps: string | null;
  teamNextSteps: Record<string, string>;
};

export function AddEventButton({
  teams,
  lockedTeamId,
  date,
  meeting,
}: {
  teams: { id: string; name: string }[];
  /** For heads: the only team they may post for besides all staff. */
  lockedTeamId?: string | null;
  date?: string;
  meeting?: MeetingDraft;
}) {
  const isMeeting = Boolean(date || meeting);
  const label = meeting ? "Edit meeting" : isMeeting ? "Add meeting" : "Add event";
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(createCalendarEvent, {});
  const choices = lockedTeamId === undefined ? teams : teams.filter((t) => t.id === lockedTeamId);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hs-btn hs-btn-primary">
        {meeting ? label : `+ ${label}`}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        description="Everyone on the portal sees it on the calendar."
        size="lg"
      >
        <form action={action} className="space-y-3">
          {isMeeting ? <input type="hidden" name="isMeeting" value="on" /> : null}
          {meeting ? <input type="hidden" name="id" value={meeting.id} /> : null}
          <div>
            <label className="hs-label" htmlFor="ev-title">Title</label>
            <input id="ev-title" defaultValue={meeting?.title} name="title" required maxLength={191} className="hs-input" autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="hs-label" htmlFor="ev-date">Date</label>
              <input id="ev-date" defaultValue={meeting?.date ?? date} name="date" type="date" required className="hs-input" />
            </div>
            <div>
              <label className="hs-label" htmlFor="ev-start">Start</label>
              <input id="ev-start" defaultValue={meeting?.start ?? undefined} name="start" type="time" className="hs-input" />
            </div>
            <div>
              <label className="hs-label" htmlFor="ev-end">End</label>
              <input id="ev-end" defaultValue={meeting?.end ?? undefined} name="end" type="time" className="hs-input" />
            </div>
          </div>
          <p className="text-[11px] text-faint">Leave the start empty for an all-day event.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="hs-label" htmlFor="ev-team">For</label>
              <select id="ev-team" name="departmentId" className="hs-input" defaultValue={meeting?.departmentId ?? ""}>
                <option value="">All staff</option>
                {choices.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="hs-label" htmlFor="ev-loc">Location</label>
              <input id="ev-loc" defaultValue={meeting?.location ?? undefined} name="location" maxLength={191} className="hs-input" />
            </div>
          </div>
          <div>
            <label className="hs-label" htmlFor="ev-notes">Notes</label>
            <textarea id="ev-notes" defaultValue={meeting?.notes ?? undefined} name="notes" rows={3} className="hs-input" />
          </div>
          {isMeeting ? (
            <>
              <label className="hs-label">Slides link
                <input name="slidesUrl" type="url" maxLength={2048} defaultValue={meeting?.slidesUrl ?? ""} className="hs-input" />
              </label>
              <label className="hs-label">Meeting summary
                <textarea name="summary" rows={3} maxLength={5000} defaultValue={meeting?.summary ?? ""} className="hs-input" />
              </label>
              <details open={Boolean(meeting && Object.keys(meeting.teamNextSteps).length)}>
                <summary className="cursor-pointer text-sm font-semibold">Next steps by team</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {teams.map((team) => (
                    <label className="hs-label" key={team.id}>{team.name}
                      <textarea name={`team-${team.id}`} rows={2} maxLength={2000} defaultValue={meeting?.teamNextSteps[team.id]} className="hs-input" />
                    </label>
                  ))}
                </div>
              </details>
              <label className="hs-label">Overall next steps
                <textarea name="nextSteps" rows={3} maxLength={5000} defaultValue={meeting?.nextSteps ?? ""} className="hs-input" />
              </label>
            </>
          ) : null}
          <Feedback state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="hs-btn hs-btn-ghost">Cancel</button>
            <SubmitButton>{meeting ? "Save meeting" : label}</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DeleteEventButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-danger-strong hover:underline">
        Delete
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete event?" description={title}>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="hs-btn hs-btn-ghost">Cancel</button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await deleteCalendarEvent(id); setOpen(false); })}
            className="hs-btn hs-btn-primary"
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </Modal>
    </>
  );
}
