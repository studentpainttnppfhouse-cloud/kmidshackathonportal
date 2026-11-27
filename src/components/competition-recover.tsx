"use client";

import { useActionState } from "react";
import { recoverTeamLink } from "@/lib/actions/competition-public";
import { Feedback, SubmitButton } from "@/components/form-bits";

export function RecoverForm({ formId }: { formId: string }) {
  const [state, action] = useActionState(recoverTeamLink, {});
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="formId" value={formId} />
      <div className="hs-honeypot" aria-hidden="true">
        <label htmlFor="company_website">Company website (leave this empty)</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <div>
        <label htmlFor="teamCode" className="block text-sm font-semibold text-ink">
          Team ID
        </label>
        <input id="teamCode" name="teamCode" required placeholder="internal01" className="hs-input mt-2" />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-ink">
          Member 1&apos;s email address
        </label>
        <input id="email" name="email" type="email" required className="hs-input mt-2" />
      </div>
      <Feedback state={state} />
      <SubmitButton className="hs-btn hs-btn-primary" pendingLabel="Sending…">
        Email a new link
      </SubmitButton>
    </form>
  );
}
