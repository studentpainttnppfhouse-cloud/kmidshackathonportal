'use client';

import { useActionState } from 'react';
import { Stethoscope, Loader2 } from 'lucide-react';
import { EcgLine } from '@/components/ecg';
import { SHIRT_SIZES } from '@/lib/types';
import { saveProfileAction, type ProfileState } from './actions';

const initialState: ProfileState = { error: null };

export function OnboardingForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(saveProfileAction, initialState);

  return (
    <div className="min-h-screen bg-bg px-5 py-10">
      <div className="mx-auto w-full max-w-[560px] animate-fadeup">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-pink text-white">
            <Stethoscope size={20} strokeWidth={1.75} />
          </div>
          <div>
            <div className="text-[16px] font-extrabold tracking-[-0.02em]">
              One quick setup
            </div>
            <div className="mono-tag text-muted">{email}</div>
          </div>
        </div>

        <div className="card p-7">
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">
            Tell us who you are
          </h1>
          <p className="mt-1.5 text-muted-2">
            This is all we keep — name, nickname, grade, phone, LINE and shirt size.
            Nothing else.
          </p>

          <div className="my-5 opacity-50">
            <EcgLine width={600} height={20} strokeWidth={1.75} />
          </div>

          <form action={formAction} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="name">Full name *</label>
                <input id="name" name="name" required maxLength={120} className="input"
                  placeholder="Praewa Thanakit" autoComplete="name" />
              </div>
              <div>
                <label className="label" htmlFor="nickname">Nickname *</label>
                <input id="nickname" name="nickname" required maxLength={60} className="input"
                  placeholder="Prae" />
              </div>
              <div>
                <label className="label" htmlFor="grade">Grade</label>
                <input id="grade" name="grade" maxLength={30} className="input"
                  placeholder="G11" />
              </div>
              <div>
                <label className="label" htmlFor="shirt_size">Shirt size</label>
                <select id="shirt_size" name="shirt_size" className="input" defaultValue="">
                  <option value="">Choose…</option>
                  {SHIRT_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="phone">Phone</label>
                <input id="phone" name="phone" type="tel" maxLength={40} className="input"
                  placeholder="08x-xxx-xxxx" autoComplete="tel" />
              </div>
              <div>
                <label className="label" htmlFor="line_id">LINE ID</label>
                <input id="line_id" name="line_id" maxLength={60} className="input"
                  placeholder="@praewa" />
              </div>
            </div>

            {state.error ? (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-[12.5px] font-medium text-danger">
                {state.error}
              </p>
            ) : null}

            <button type="submit" disabled={pending} className="btn-primary mt-1 w-full py-3">
              {pending ? (
                <><Loader2 size={16} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
              ) : (
                'Start using Hackathon Studio'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
