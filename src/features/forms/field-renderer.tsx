'use client';

import {
  ANSWERABLE, type AnswerValue, type Answers, type FormField,
} from '@/lib/forms';

/**
 * Renders one field. Shared by the public submission page and the builder's
 * live preview, so what a student sees while building is what respondents get.
 */
export function FieldRenderer({
  field,
  value,
  error,
  onChange,
  disabled = false,
}: {
  field: FormField;
  value: AnswerValue;
  error?: string;
  onChange: (value: AnswerValue) => void;
  disabled?: boolean;
}) {
  const id = `field-${field.id}`;
  const described = error ? `${id}-error` : field.help ? `${id}-help` : undefined;

  if (field.type === 'section') {
    return (
      <div className="border-t border-line pt-6">
        <h2 className="text-[18px] font-extrabold tracking-[-0.01em]">{field.label}</h2>
        {field.help ? <p className="mt-1 text-[13px] text-muted-2">{field.help}</p> : null}
      </div>
    );
  }

  if (field.type === 'description') {
    return <p className="text-[13.5px] leading-relaxed text-muted-2">{field.label}</p>;
  }

  return (
    <div>
      <label className="mb-1.5 block text-[13.5px] font-semibold" htmlFor={id}>
        {field.label}
        {field.required ? <span className="ml-1 text-pink">*</span> : null}
      </label>
      {field.help ? (
        <p id={`${id}-help`} className="mb-1.5 text-[12px] text-muted-2">{field.help}</p>
      ) : null}

      <Control field={field} id={id} value={value} onChange={onChange}
        disabled={disabled} described={described} />

      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-[12px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Control({
  field, id, value, onChange, disabled, described,
}: {
  field: FormField;
  id: string;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  disabled: boolean;
  described?: string;
}) {
  const common = {
    id,
    disabled,
    'aria-describedby': described,
    'aria-required': field.required,
    className: 'input',
  };

  switch (field.type) {
    case 'paragraph':
      return (
        <textarea {...common} rows={4} placeholder={field.placeholder}
          value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}
          className="input resize-y" />
      );

    case 'dropdown':
      return (
        <select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          {field.allowOther ? <option value="__other">Other…</option> : null}
        </select>
      );

    case 'radio':
      return (
        <div role="radiogroup" aria-labelledby={id} className="flex flex-col gap-2">
          {(field.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2.5 text-[13.5px]">
              <input type="radio" name={id} value={o} disabled={disabled}
                checked={value === o} onChange={() => onChange(o)}
                className="h-4 w-4 accent-pink" />
              {o}
            </label>
          ))}
        </div>
      );

    case 'checkboxes': {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-col gap-2">
          {(field.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-2.5 text-[13.5px]">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.includes(o)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...selected, o] : selected.filter((s) => s !== o),
                  )
                }
                className="h-4 w-4 accent-pink"
              />
              {o}
            </label>
          ))}
        </div>
      );
    }

    case 'linear_scale': {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            {steps.map((n) => (
              <label key={n} className="flex flex-col items-center gap-1 text-[12px]">
                <input type="radio" name={id} disabled={disabled}
                  checked={Number(value) === n} onChange={() => onChange(n)}
                  className="h-4 w-4 accent-pink" />
                {n}
              </label>
            ))}
          </div>
          {field.minLabel || field.maxLabel ? (
            <div className="mt-1 flex justify-between text-[11.5px] text-muted-2">
              <span>{field.minLabel}</span>
              <span>{field.maxLabel}</span>
            </div>
          ) : null}
        </div>
      );
    }

    case 'grid': {
      const answers = (value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {}) as Record<string, string>;
      return (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-2">
                <th className="p-2" />
                {(field.columns ?? []).map((c) => (
                  <th key={c} className="p-2 text-[12px] font-semibold text-muted-2">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(field.rows ?? []).map((r) => (
                <tr key={r} className="border-t border-line">
                  <th className="p-2 text-left text-[12.5px] font-semibold">{r}</th>
                  {(field.columns ?? []).map((c) => (
                    <td key={c} className="p-2 text-center">
                      <input type="radio" name={`${id}-${r}`} disabled={disabled}
                        checked={answers[r] === c}
                        onChange={() => onChange({ ...answers, [r]: c })}
                        className="h-4 w-4 accent-pink"
                        aria-label={`${r} — ${c}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'file':
      return (
        <input {...common} type="file"
          onChange={(e) => onChange(e.target.files?.[0]?.name ?? '')} />
      );

    default: {
      const inputType =
        field.type === 'date' ? 'date'
        : field.type === 'time' ? 'time'
        : field.type === 'number' ? 'number'
        : field.type === 'email' ? 'email'
        : field.type === 'phone' ? 'tel'
        : field.type === 'url' ? 'url'
        : 'text';
      return (
        <input {...common} type={inputType} placeholder={field.placeholder}
          value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    }
  }
}

export { ANSWERABLE };
export type { Answers };
