"use client";

import { useActionState } from "react";
import { requestRecovery } from "@/lib/actions/people";
import type { FormState } from "@/lib/actions/auth";
import { BotFields, Feedback, SubmitButton } from "@/components/form-bits";

const initial: FormState = {};

export function ForgotForm() {
  const [state, action] = useActionState(requestRecovery, initial);

  if (state.ok) return <Feedback state={state} />;

  return (
    <form action={action} className="space-y-4">
      <BotFields />

      <div>
        <label className="hs-label" htmlFor="email">Your account email</label>
        <input id="email" name="email" type="email" required maxLength={190}
          autoComplete="email" spellCheck={false} className="hs-input" />
      </div>

      <Feedback state={state} />

      <SubmitButton pendingLabel="Sending…">Email me a reset link</SubmitButton>
    </form>
  );
}
