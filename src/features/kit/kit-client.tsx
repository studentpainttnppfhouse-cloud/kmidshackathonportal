'use client';

import { useState } from 'react';
import {
  Activity, AlertCircle, Heart, Inbox, Pill, Plus, Shield, Stethoscope, X,
} from 'lucide-react';
import { EcgLine, EcgLoading } from '@/components/ecg';
import { TierBadge } from '@/components/tier-badge';
import { Avatar } from '@/components/avatar';
import { ASSIGNMENT_STATUS_META, ASSIGNMENT_STATUSES, TIERS } from '@/lib/types';

export function KitClient() {
  const [state, setState] = useState<'loading' | 'empty' | 'error'>('loading');
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState(false);

  return (
    <div className="mx-auto flex max-w-[1000px] animate-fadeup flex-col gap-5">
      <Section title="States" description="What every screen falls back to.">
        <div className="mb-4 inline-flex gap-1 rounded-[11px] border border-line bg-surface-2 p-1">
          {(['loading', 'empty', 'error'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setState(s)} aria-pressed={state === s}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold capitalize transition-colors ${
                state === s ? 'bg-pink text-white' : 'text-muted-2'
              }`}>
              {s}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          {state === 'loading' ? <EcgLoading /> : null}
          {state === 'empty' ? (
            <div className="py-14 text-center">
              <Inbox size={28} className="mx-auto mb-3 text-muted" />
              <p className="text-[14px] font-semibold">Nothing here yet</p>
              <p className="mt-1 text-[13px] text-muted-2">
                When someone adds the first one, it shows up here.
              </p>
              <button type="button" className="btn-primary mt-4">
                <Plus size={15} /> Add the first
              </button>
            </div>
          ) : null}
          {state === 'error' ? (
            <div className="py-14 text-center">
              <AlertCircle size={28} className="mx-auto mb-3 text-danger" />
              <p className="text-[14px] font-semibold">That did not load</p>
              <p className="mt-1 text-[13px] text-muted-2">
                Check your connection and try again. Nothing was lost.
              </p>
              <button type="button" className="btn-secondary mt-4">Try again</button>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Buttons" description="Pink fill, pink outline, plain text. Nothing else.">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary">Primary</button>
          <button type="button" className="btn-secondary">Secondary</button>
          <button type="button" className="btn-tertiary">Tertiary</button>
          <button type="button" className="btn-quiet">Quiet</button>
          <button type="button" className="btn-primary" disabled>Disabled</button>
        </div>
      </Section>

      <Section title="Tier badges" description="Cumulative, T0 sits outside the ladder.">
        <div className="flex flex-wrap gap-2">
          {TIERS.map((t) => <TierBadge key={t} tier={t} />)}
        </div>
      </Section>

      <Section title="Status pills" description="The assignment flow, in order.">
        <div className="flex flex-wrap gap-2">
          {ASSIGNMENT_STATUSES.map((s) => {
            const meta = ASSIGNMENT_STATUS_META[s];
            return (
              <span key={s} className="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                style={{
                  color: meta.color,
                  background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
                }}>
                {meta.label}
              </span>
            );
          })}
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="k-text">Text input</label>
            <input id="k-text" className="input" placeholder="Placeholder" />
          </div>
          <div>
            <label className="label" htmlFor="k-select">Select</label>
            <select id="k-select" className="input">
              <option>Choose…</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="k-area">Textarea</label>
            <textarea id="k-area" rows={2} className="input resize-y" />
          </div>
          <label className="flex items-center gap-2 text-[13px] font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-pink" defaultChecked /> Checkbox
          </label>
          <label className="flex items-center gap-2 text-[13px] font-semibold">
            <input type="radio" name="k-radio" className="h-4 w-4 accent-pink" defaultChecked /> Radio
          </label>
        </div>
      </Section>

      <Section title="ECG motif" description="One or two per screen. Never more.">
        <div className="flex flex-col gap-4">
          <EcgLine width={800} height={40} />
          <EcgLine width={800} height={40} animate />
          <EcgLine width={800} height={40} color="var(--deep)" strokeWidth={1.75} />
        </div>
      </Section>

      <Section title="Medical glyphs" description="lucide-react, 1.75 stroke.">
        <div className="flex flex-wrap gap-4">
          {[Heart, Activity, Shield, Stethoscope, Pill, Plus].map((Icon, i) => (
            <div key={i} className="grid h-11 w-11 place-items-center rounded-xl bg-surface-3 text-deep">
              <Icon size={20} strokeWidth={1.75} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Avatars">
        <div className="flex flex-wrap items-center gap-3">
          {['Praewa', 'Napat', 'Mint', 'Kao', 'Ploy'].map((n) => (
            <Avatar key={n} name={n} size={44} />
          ))}
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setModal(true)} className="btn-secondary">
            Open a dialog
          </button>
          <button type="button" className="btn-secondary"
            onClick={() => {
              setToast(true);
              setTimeout(() => setToast(false), 2600);
            }}>
            Fire a toast
          </button>
        </div>
      </Section>

      {modal ? (
        <>
          <button type="button" aria-label="Close" onClick={() => setModal(false)}
            className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]" />
          <div role="dialog" aria-modal="true" aria-label="Example dialog"
            className="fixed left-1/2 top-1/2 z-[51] w-[420px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 animate-fadeup rounded-2xl border border-line bg-surface p-6 shadow-raised">
            <div className="mb-3 flex items-center">
              <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">Example dialog</h2>
              <button type="button" onClick={() => setModal(false)} aria-label="Close"
                className="ml-auto text-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <p className="mb-5 text-[13.5px] text-muted-2">
              Dialogs close on Escape and on a click outside, and always name themselves
              for a screen reader.
            </p>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setModal(false)} className="btn-primary flex-1">
                Confirm
              </button>
              <button type="button" onClick={() => setModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </>
      ) : null}

      {toast ? (
        <div role="status" aria-live="polite"
          className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 shadow-raised">
          <span className="h-2 w-2 rounded-full bg-teal" />
          <span className="text-[13px] font-semibold">Saved</span>
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title, description, children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="text-[15px] font-bold">{title}</h2>
      {description ? <p className="mb-4 mt-0.5 text-[12.5px] text-muted-2">{description}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}
