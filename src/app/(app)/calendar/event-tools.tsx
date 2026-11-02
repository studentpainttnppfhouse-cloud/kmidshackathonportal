"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { Feedback, SubmitButton } from "@/components/form-bits";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/actions/calendar";
import type { FormState } from "@/lib/actions/auth";

export function AddEventButton({
  teams,
  lockedTeamId,
}: {
  teams: { id: string; name: string }[];
  /** For heads: the only team they may post for besides all staff. */
  lockedTeamId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(createCalendarEvent, {});
  const choices = lockedTeamId === undefined ? teams : teams.filter((t) => t.id === lockedTeamId);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hs-btn hs-btn-primary">
        + Add event
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add calendar event"
        description="Everyone on the portal sees it on the calendar."
        size="lg"
      >
        <form action={action} className="space-y-3">
          <div>
            <label className="hs-label" htmlFor="ev-title">Title</label>
            <input id="ev-title" name="title" required maxLength={191} className="hs-input" autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="hs-label" htmlFor="ev-date">Date</label>
              <input id="ev-date" name="date" type="date" required className="hs-input" />
            </div>
            <div>
              <label className="hs-label" htmlFor="ev-start">Start</label>
              <input id="ev-start" name="start" type="time" className="hs-input" />
            </div>
            <div>
              <label className="hs-label" htmlFor="ev-end">End</label>
              <input id="ev-end" name="end" type="time" className="hs-input" />
            </div>
          </div>
          <p className="text-[11px] text-faint">Leave the start empty for an all-day event.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="hs-label" htmlFor="ev-team">For</label>
              <select id="ev-team" name="departmentId" className="hs-input" defaultValue="">
                <option value="">All staff</option>
                {choices.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="hs-label" htmlFor="ev-loc">Location</label>
              <input id="ev-loc" name="location" maxLength={191} className="hs-input" />
            </div>
          </div>
          <div>
            <label className="hs-label" htmlFor="ev-notes">Notes</label>
            <textarea id="ev-notes" name="notes" rows={3} className="hs-input" />
          </div>
          <Feedback state={state} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="hs-btn hs-btn-ghost">Cancel</button>
            <SubmitButton>Add event</SubmitButton>
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
