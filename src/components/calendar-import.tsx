"use client";
import { useActionState } from "react";
import { importPostingCalendar } from "@/lib/actions/workspace";
import { Feedback, SubmitButton } from "./form-bits";
import type { FormState } from "@/lib/actions/auth";
export function CalendarImport() {
  const [state, action] = useActionState(
    importPostingCalendar,
    {} as FormState,
  );
  return (
    <details className="hs-card p-4">
      <summary className="cursor-pointer font-semibold">
        Import posting calendar
      </summary>
      <form action={action} className="mt-3 space-y-3">
        <p className="text-sm text-muted">
          Import a JSON list of proposed posts: id, title, date (YYYY-MM-DD),
          time (HH:mm, Bangkok), owner. Posts are visible to everyone in the
          portal. Importing does not publish them.
        </p>
        <input
          aria-label="Posting calendar JSON"
          type="file"
          name="calendar"
          accept=".json,application/json"
          required
        />
        <SubmitButton className="hs-btn hs-btn-secondary">
          Import posts
        </SubmitButton>
        <Feedback state={state} />
      </form>
    </details>
  );
}
