'use client';

import { useState, useTransition } from 'react';
import {
  ChevronDown, ChevronUp, Copy, GripVertical, Plus, Settings2, Trash2, Check, Loader2,
} from 'lucide-react';
import {
  FIELD_LABELS, FIELD_TYPES, blankField, hasOptions, isVisible, newFieldId,
  type Answers, type FormField, type FormSettings, type FieldType,
} from '@/lib/forms';
import { FieldRenderer } from './field-renderer';
import { saveFormAction } from './actions';

export function FormBuilder({
  formId,
  initialTitle,
  initialDescription,
  initialFields,
  initialSettings,
}: {
  formId: string;
  initialTitle: string;
  initialDescription: string;
  initialFields: FormField[];
  initialSettings: FormSettings;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [fields, setFields] = useState<FormField[]>(initialFields);
  const [settings, setSettings] = useState<FormSettings>(initialSettings);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function mutate(next: FormField[]) {
    setFields(next);
    setSaved(false);
  }

  function update(id: string, patch: Partial<FormField>) {
    mutate(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function add(type: FieldType) {
    const field = blankField(type);
    mutate([...fields, field]);
    setOpenId(field.id);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= fields.length) return;
    const next = [...fields];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    mutate(next);
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveFormAction(formId, { title, description, fields, settings });
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <div className="card p-5">
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setSaved(false); }}
            aria-label="Form title"
            placeholder="Form title"
            className="w-full border-0 bg-transparent text-[22px] font-extrabold tracking-[-0.02em] text-ink outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => { setDescription(e.target.value); setSaved(false); }}
            aria-label="Form description"
            placeholder="A short description for respondents…"
            rows={2}
            className="mt-2 w-full resize-y border-0 bg-transparent text-[13.5px] text-muted-2 outline-none"
          />
        </div>

        {fields.map((field, index) => (
          <div
            key={field.id}
            draggable
            onDragStart={() => setDragging(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging !== null) move(dragging, index);
              setDragging(null);
            }}
            className="card p-4"
          >
            <div className="flex items-center gap-2">
              <GripVertical size={15} className="cursor-grab text-muted" aria-hidden />
              <span className="mono-tag rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-muted-2">
                {FIELD_LABELS[field.type]}
              </span>
              <input
                value={field.label}
                onChange={(e) => update(field.id, { label: e.target.value })}
                aria-label="Question label"
                className="min-w-0 flex-1 border-0 bg-transparent text-[14px] font-semibold text-ink outline-none"
              />
              <button type="button" onClick={() => move(index, index - 1)} aria-label="Move up"
                className="text-muted hover:text-ink"><ChevronUp size={15} /></button>
              <button type="button" onClick={() => move(index, index + 1)} aria-label="Move down"
                className="text-muted hover:text-ink"><ChevronDown size={15} /></button>
              <button type="button" aria-label="Duplicate"
                onClick={() => mutate([...fields.slice(0, index + 1), { ...field, id: newFieldId() }, ...fields.slice(index + 1)])}
                className="text-muted hover:text-ink"><Copy size={14} /></button>
              <button type="button" aria-label="Field settings"
                onClick={() => setOpenId(openId === field.id ? null : field.id)}
                className={openId === field.id ? 'text-pink' : 'text-muted hover:text-ink'}>
                <Settings2 size={15} />
              </button>
              <button type="button" aria-label="Delete field"
                onClick={() => mutate(fields.filter((f) => f.id !== field.id))}
                className="text-muted hover:text-danger"><Trash2 size={14} /></button>
            </div>

            {openId === field.id ? (
              <FieldSettings field={field} allFields={fields} index={index}
                onChange={(patch) => update(field.id, patch)} />
            ) : (
              <div className="mt-3 border-t border-line pt-3 opacity-70">
                <FieldRenderer field={field} value={null} onChange={() => {}} disabled />
              </div>
            )}
          </div>
        ))}

        <div className="card p-4">
          <div className="label">Add a question</div>
          <div className="flex flex-wrap gap-1.5">
            {FIELD_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => add(t)}
                className="rounded-md border border-line-2 bg-surface-2 px-2.5 py-1.5 text-[12px] font-semibold text-muted-2 transition-colors hover:border-pink hover:text-ink">
                <Plus size={11} className="mr-1 inline" />
                {FIELD_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <aside className="sticky top-[76px] flex flex-col gap-4">
        <div className="card p-5">
          <h2 className="mb-3.5 text-[14px] font-bold">Form settings</h2>
          <div className="flex flex-col gap-3">
            <Toggle label="Require sign-in" checked={settings.loginRequired ?? false}
              onChange={(v) => { setSettings({ ...settings, loginRequired: v }); setSaved(false); }}
              hint="Off means anyone with the link can respond." />
            <Toggle label="One response per person" checked={settings.oneResponsePerUser ?? false}
              onChange={(v) => { setSettings({ ...settings, oneResponsePerUser: v }); setSaved(false); }} />
            <Toggle label="Allow editing after submit" checked={settings.allowEditAfterSubmit ?? false}
              onChange={(v) => { setSettings({ ...settings, allowEditAfterSubmit: v }); setSaved(false); }} />
            <div>
              <label className="label" htmlFor="confirm-msg">Confirmation message</label>
              <textarea id="confirm-msg" rows={2} className="input resize-y"
                value={settings.confirmationMessage ?? ''}
                onChange={(e) => { setSettings({ ...settings, confirmationMessage: e.target.value }); setSaved(false); }}
                placeholder="Thanks — we'll be in touch." />
            </div>
          </div>
        </div>

        <div className="card p-5">
          <button type="button" onClick={save} disabled={pending || saved} className="btn-primary w-full">
            {pending ? (
              <><Loader2 size={15} className="animate-[spin_1s_linear_infinite]" /> Saving…</>
            ) : saved ? (
              <><Check size={15} /> Saved</>
            ) : (
              'Save changes'
            )}
          </button>
          {error ? (
            <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <p className="mt-3 text-[12px] text-muted-2">
            {fields.filter((f) => f.type !== 'section' && f.type !== 'description').length} questions ·{' '}
            {fields.filter((f) => f.condition).length} conditional
          </p>
        </div>
      </aside>
    </div>
  );
}

function Toggle({
  label, checked, onChange, hint,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 text-[13px] font-semibold">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-pink" />
      <span>
        {label}
        {hint ? <span className="block text-[11.5px] font-normal text-muted-2">{hint}</span> : null}
      </span>
    </label>
  );
}

function FieldSettings({
  field, allFields, index, onChange,
}: {
  field: FormField;
  allFields: FormField[];
  index: number;
  onChange: (patch: Partial<FormField>) => void;
}) {
  // Only earlier fields can drive a condition, which keeps the graph acyclic.
  const earlier = allFields.slice(0, index).filter((f) => hasOptions(f.type));
  const controller = allFields.find((f) => f.id === field.condition?.fieldId);

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Help text</label>
          <input value={field.help ?? ''} onChange={(e) => onChange({ help: e.target.value })}
            className="input" placeholder="Shown under the question" />
        </div>
        <div>
          <label className="label">Placeholder</label>
          <input value={field.placeholder ?? ''} onChange={(e) => onChange({ placeholder: e.target.value })}
            className="input" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[13px] font-semibold">
        <input type="checkbox" checked={field.required ?? false}
          onChange={(e) => onChange({ required: e.target.checked })} className="h-4 w-4 accent-pink" />
        Required
      </label>

      {hasOptions(field.type) ? (
        <div>
          <label className="label">Options</label>
          <div className="flex flex-col gap-1.5">
            {(field.options ?? []).map((opt, i) => (
              <div key={i} className="flex gap-1.5">
                <input value={opt} className="input"
                  onChange={(e) => {
                    const next = [...(field.options ?? [])];
                    next[i] = e.target.value;
                    onChange({ options: next });
                  }} />
                <button type="button" aria-label={`Remove option ${i + 1}`}
                  onClick={() => onChange({ options: (field.options ?? []).filter((_, j) => j !== i) })}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line-2 text-muted hover:text-danger">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => onChange({ options: [...(field.options ?? []), `Option ${(field.options?.length ?? 0) + 1}`] })}
              className="btn-quiet self-start">
              <Plus size={13} /> Add option
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[13px] font-semibold">
            <input type="checkbox" checked={field.allowOther ?? false}
              onChange={(e) => onChange({ allowOther: e.target.checked })} className="h-4 w-4 accent-pink" />
            Include an &ldquo;Other&rdquo; option
          </label>
        </div>
      ) : null}

      {field.type === 'linear_scale' ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Min</label>
            <input type="number" value={field.min ?? 1} className="input"
              onChange={(e) => onChange({ min: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Max</label>
            <input type="number" value={field.max ?? 5} className="input"
              onChange={(e) => onChange({ max: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Min label</label>
            <input value={field.minLabel ?? ''} className="input"
              onChange={(e) => onChange({ minLabel: e.target.value })} />
          </div>
          <div>
            <label className="label">Max label</label>
            <input value={field.maxLabel ?? ''} className="input"
              onChange={(e) => onChange({ maxLabel: e.target.value })} />
          </div>
        </div>
      ) : null}

      {field.type === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Rows (one per line)</label>
            <textarea rows={3} className="input resize-y" value={(field.rows ?? []).join('\n')}
              onChange={(e) => onChange({ rows: e.target.value.split('\n').filter(Boolean) })} />
          </div>
          <div>
            <label className="label">Columns (one per line)</label>
            <textarea rows={3} className="input resize-y" value={(field.columns ?? []).join('\n')}
              onChange={(e) => onChange({ columns: e.target.value.split('\n').filter(Boolean) })} />
          </div>
        </div>
      ) : null}

      <div className="rounded-md border border-line bg-surface-2 p-3">
        <div className="label">Conditional logic</div>
        {earlier.length === 0 ? (
          <p className="text-[12px] text-muted-2">
            Add a dropdown, radio or checkbox question above this one to branch on it.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              className="input"
              aria-label="Show this only when"
              value={field.condition?.fieldId ?? ''}
              onChange={(e) =>
                onChange({
                  condition: e.target.value
                    ? { fieldId: e.target.value, equals: field.condition?.equals ?? '' }
                    : null,
                })
              }
            >
              <option value="">Always show</option>
              {earlier.map((f) => (
                <option key={f.id} value={f.id}>Show when “{f.label}” is…</option>
              ))}
            </select>

            {field.condition ? (
              <select
                className="input"
                aria-label="Equals"
                value={field.condition.equals}
                onChange={(e) =>
                  onChange({ condition: { fieldId: field.condition!.fieldId, equals: e.target.value } })
                }
              >
                <option value="">Choose an answer…</option>
                {(controller?.options ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
