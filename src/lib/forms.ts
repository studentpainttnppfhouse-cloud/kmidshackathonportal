/**
 * Form schema — shared by the builder, the public submission page and the
 * responses table, so all three agree on what a field is.
 */

export const FIELD_TYPES = [
  'short_text', 'paragraph', 'dropdown', 'checkboxes', 'radio', 'date', 'time',
  'number', 'email', 'phone', 'url', 'linear_scale', 'grid', 'file', 'section',
  'description',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_LABELS: Record<FieldType, string> = {
  short_text: 'Short text',
  paragraph: 'Paragraph',
  dropdown: 'Dropdown',
  checkboxes: 'Checkboxes',
  radio: 'Multiple choice',
  date: 'Date',
  time: 'Time',
  number: 'Number',
  email: 'Email',
  phone: 'Phone',
  url: 'URL',
  linear_scale: 'Linear scale',
  grid: 'Multiple choice grid',
  file: 'File upload',
  section: 'Section break',
  description: 'Description text',
};

/** Fields that collect an answer, as opposed to laying the form out. */
export const ANSWERABLE: ReadonlySet<FieldType> = new Set(
  FIELD_TYPES.filter((t) => t !== 'section' && t !== 'description'),
);

export function hasOptions(type: FieldType): boolean {
  return type === 'dropdown' || type === 'checkboxes' || type === 'radio' || type === 'grid';
}

/**
 * Show this field only when a previous answer matches. Section branching in
 * the recruitment forms depends on this.
 */
export interface Condition {
  fieldId: string;
  equals: string;
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  allowOther?: boolean;
  /** linear_scale */
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  /** grid */
  rows?: string[];
  columns?: string[];
  condition?: Condition | null;
}

export interface FormSchema {
  fields: FormField[];
}

export interface FormSettings {
  confirmationMessage?: string;
  oneResponsePerUser?: boolean;
  allowEditAfterSubmit?: boolean;
  loginRequired?: boolean;
}

export type AnswerValue = string | number | string[] | Record<string, string> | null;
export type Answers = Record<string, AnswerValue>;

/**
 * Whether a field should render, given the answers so far. A field whose
 * controlling field is itself hidden stays hidden — otherwise branching two
 * levels deep would leak.
 */
export function isVisible(
  field: FormField,
  fields: FormField[],
  answers: Answers,
  seen: Set<string> = new Set(),
): boolean {
  if (!field.condition) return true;
  // Guard against a cycle someone built by accident in the editor.
  if (seen.has(field.id)) return true;

  const parent = fields.find((f) => f.id === field.condition?.fieldId);
  if (!parent) return true;

  if (!isVisible(parent, fields, answers, new Set([...seen, field.id]))) return false;

  const answer = answers[parent.id];
  const target = field.condition.equals;

  if (Array.isArray(answer)) return answer.includes(target);
  return String(answer ?? '') === target;
}

/** Validate a submission against the schema. Returns per-field messages. */
export function validateAnswers(
  fields: FormField[],
  answers: Answers,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    if (!ANSWERABLE.has(field.type)) continue;
    if (!isVisible(field, fields, answers)) continue;

    const value = answers[field.id];
    const empty =
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);

    if (field.required && empty) {
      errors[field.id] = 'This question is required';
      continue;
    }
    if (empty) continue;

    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
      errors[field.id] = 'Enter a valid email address';
    }
    if (field.type === 'url') {
      try {
        // eslint-disable-next-line no-new
        new URL(String(value));
      } catch {
        errors[field.id] = 'Enter a valid URL';
      }
    }
    if (field.type === 'number' && Number.isNaN(Number(value))) {
      errors[field.id] = 'Enter a number';
    }
    if (field.type === 'phone' && !/^[\d\s+()-]{6,}$/.test(String(value))) {
      errors[field.id] = 'Enter a valid phone number';
    }
  }

  return errors;
}

export function newFieldId(): string {
  return `f_${Math.random().toString(36).slice(2, 10)}`;
}

export function blankField(type: FieldType): FormField {
  const base: FormField = { id: newFieldId(), type, label: FIELD_LABELS[type] };
  if (hasOptions(type)) base.options = ['Option 1', 'Option 2'];
  if (type === 'linear_scale') {
    base.min = 1;
    base.max = 5;
  }
  if (type === 'grid') {
    base.rows = ['Row 1', 'Row 2'];
    base.columns = ['Column 1', 'Column 2'];
  }
  if (type === 'description') base.label = 'Some explanatory text for respondents.';
  if (type === 'section') base.label = 'Section title';
  return base;
}

/** Flatten one response into CSV-ready cells. */
export function answerToText(value: AnswerValue): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => `${k}: ${v}`).join('; ');
  }
  return String(value);
}
