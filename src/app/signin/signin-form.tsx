'use client';

import { useActionState, useState } from 'react';
import { Heart, LogIn, KeyRound, Loader2 } from 'lucide-react';
import { EcgLine } from '@/components/ecg';
import { signInAction, type SignInState } from './actions';

const initialState: SignInState = { error: null };

export function SignInForm({ next, domain }: { next?: string; domain: string }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
      style={{
        background:
          'radial-gradient(120% 90% at 50% -10%, var(--surface) 0%, var(--wash) 55%, var(--surface-3) 100%)',
      }}
    >
      <div className="absolute inset-x-0 top-0 opacity-50">
        <EcgLine width={1200} height={90} animate />
      </div>

      <div className="relative w-full max-w-[420px] animate-fadeup rounded-3xl border border-line bg-surface p-9 shadow-raised">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-pink text-white">
            <Heart size={20} strokeWidth={1.75} />
          </div>
          <div className="text-[16px] font-extrabold tracking-[-0.02em]">Hackathon Studio</div>
        </div>

        <h1 className="mb-1.5 text-2xl font-extrabold tracking-[-0.02em]">Staff sign-in</h1>
        <p className="mb-6 text-muted-2">
          KMIDS Hackathon 2027 · MedTech &amp; Digital Health
        </p>

        <form action={formAction} className="flex flex-col gap-3">
          {next ? <input type="hidden" name="next" value={next} /> : null}

          <div>
            <label className="label" htmlFor="email">
              School email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              placeholder={`yourname@${domain}`}
              className="input"
              aria-describedby={state.error ? 'signin-error' : 'signin-hint'}
            />
          </div>

          {showKey ? (
            <div>
              <label className="label" htmlFor="inviteCode">
                Invite key
              </label>
              <input
                id="inviteCode"
                name="inviteCode"
                type="text"
                autoComplete="off"
                placeholder="e.g. OPS-2027-A7F3"
                className="input font-mono uppercase tracking-[0.08em]"
              />
            </div>
          ) : null}

          {state.error ? (
            <p
              id="signin-error"
              role="alert"
              className="rounded-md bg-danger-soft px-3 py-2.5 text-[12.5px] font-medium text-danger"
            >
              {state.error}
            </p>
          ) : null}

          <button type="submit" disabled={pending} className="btn-primary mt-1 w-full py-3">
            {pending ? (
              <>
                <Loader2 size={16} className="animate-[spin_1s_linear_infinite]" />
                Signing you in…
              </>
            ) : (
              <>
                <LogIn size={16} />
                Sign in
              </>
            )}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="btn-tertiary mt-3 w-full"
        >
          <KeyRound size={14} />
          {showKey ? 'I do not have a key' : 'I have an invite key'}
        </button>

        <div className="my-5 h-px bg-line" />

        <p id="signin-hint" className="text-[12.5px] leading-relaxed text-muted-2">
          No password needed — just your <strong className="text-ink">@{domain}</strong> address.
          This device stays signed in, so you will not have to do this again on event morning.
        </p>
      </div>
    </div>
  );
}
