'use client';

import { useState, useTransition } from 'react';
import { Heart, Check, Loader2 } from 'lucide-react';
import { EcgLine } from '@/components/ecg';
import { isVisible, validateAnswers, type Answers, type FormField } from '@/lib/forms';
import { FieldRenderer } from './field-renderer';
import { submitResponseAction } from './actions';

const DRAFT_PREFIX = 'hs-form-draft-';

/**
 * The public submission page: clean single column, branded, mobile-first.
 * Drafts autosave to the device so a half-finished application survives a
 * closed tab.
 */
export function PublicForm({
  formId,
  title,
  description,
  fields,
  confirmationMessage,
  requiresEmail,
  preview = false,
}: {
  formId: string;
  title: string;
  description: string | null;
  fields: FormField[];
  confirmationMessage?: string;
  requiresEmail: boolean;
  preview?: boolean;
}) {
  const [answers, setAnswers] = useState<Answers>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + formId);
      return raw ? (JSON.parse(raw) as Answers) : {};
    } catch {
      return {};
    }
  });
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function setAnswer(id: string, value: unknown) {
    const next = { ...answers, [id]: value as never };
    setAnswers(next);
    if (!preview) {
      try {
        localStorage.setItem(DRAFT_PREFIX + formId, JSON.stringify(next));
      } catch {
        // A full or blocked localStorage should never stop someone submitting.
      }
    }
  }

  const visible = fields.filter((f) => isVisible(f, fields, answers));

  if (done) {
    return (
      <Shell title={title}>
        <div className="py-10 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-surface-3 text-teal">
            <Check size={28} />
          </div>
          <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">Response recorded</h2>
          <p className="mt-2 text-[13.5px] text-muted-2">
            {confirmationMessage || "Thanks — we'll be in touch."}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={title} description={description}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setFormError(null);
          const found = validateAnswers(fields, answers);
          setErrors(found);
          if (Object.keys(found).length > 0) {
            setFormError('Some required questions are still blank.');
            return;
          }
          if (preview) {
            setDone(true);
            return;
          }
          start(async () => {
            const res = await submitResponseAction(formId, answers, email || undefined);
            if (res.ok) {
              setDone(true);
              try {
                localStorage.removeItem(DRAFT_PREFIX + formId);
              } catch {
                /* ignore */
              }
            } else {
              setFormError(res.error);
            }
          });
        }}
      >
        {requiresEmail ? (
          <div>
            <label className="mb-1.5 block text-[13.5px] font-semibold" htmlFor="respondent-email">
              Your email <span className="text-pink">*</span>
            </label>
            <input id="respondent-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} className="input"
              placeholder="yourname@kmids.ac.th" />
          </div>
        ) : null}

        {visible.map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={answers[field.id] ?? null}
            error={errors[field.id]}
            onChange={(v) => setAnswer(field.id, v)}
          />
        ))}

        {fields.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted-2">
            This form has no questions yet.
          </p>
        ) : null}

        {formError ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-[12.5px] font-semibold text-danger">
            {formError}
          </p>
        ) : null}

        {fields.length > 0 ? (
          <button type="submit" disabled={pending} className="btn-primary w-full py-3">
            {pending ? (
              <><Loader2 size={16} className="animate-[spin_1s_linear_infinite]" /> Sending…</>
            ) : (
              'Submit'
            )}
          </button>
        ) : null}

        {!preview ? (
          <p className="text-center text-[11.5px] text-muted">
            Your answers are saved on this device as you go.
          </p>
        ) : null}
      </form>
    </Shell>
  );
}

function Shell({
  title, description, children,
}: {
  title: string;
  description?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg px-4 py-8 md:py-12">
      <div className="mx-auto w-full max-w-[620px]">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-pink text-white">
            <Heart size={18} strokeWidth={1.75} />
          </div>
          <div>
            <div className="text-[14px] font-extrabold tracking-[-0.02em]">Hackathon Studio</div>
            <div className="mono-tag text-muted">KMIDS · 2027</div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-line px-6 pb-5 pt-6"
            style={{ background: 'linear-gradient(120deg, var(--surface) 0%, var(--wash) 100%)' }}>
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">{title}</h1>
            {description ? (
              <p className="mt-1.5 text-[13.5px] text-muted-2">{description}</p>
            ) : null}
            <div className="mt-3 opacity-60">
              <EcgLine width={600} height={22} strokeWidth={2} />
            </div>
          </div>

          <div className="px-6 py-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
