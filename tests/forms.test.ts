import { describe, expect, it } from 'vitest';
import {
  answerToText, blankField, isVisible, validateAnswers, type FormField,
} from '@/lib/forms';

function field(over: Partial<FormField> & { id: string }): FormField {
  return { type: 'short_text', label: over.id, ...over };
}

describe('conditional logic', () => {
  const fields: FormField[] = [
    field({ id: 'role', type: 'radio', options: ['Designer', 'Editor'] }),
    field({ id: 'portfolio', condition: { fieldId: 'role', equals: 'Designer' } }),
    field({ id: 'software', condition: { fieldId: 'portfolio', equals: 'yes' } }),
  ];

  it('hides a field whose condition is unmet', () => {
    expect(isVisible(fields[1]!, fields, { role: 'Editor' })).toBe(false);
  });

  it('shows a field whose condition is met', () => {
    expect(isVisible(fields[1]!, fields, { role: 'Designer' })).toBe(true);
  });

  it('keeps a nested field hidden when its parent is hidden', () => {
    // portfolio is hidden because role is Editor, so software must stay hidden
    // even though its own condition is satisfied.
    expect(isVisible(fields[2]!, fields, { role: 'Editor', portfolio: 'yes' })).toBe(false);
  });

  it('matches against any selected checkbox', () => {
    const multi: FormField[] = [
      field({ id: 'depts', type: 'checkboxes', options: ['Ops', 'Film'] }),
      field({ id: 'camera', condition: { fieldId: 'depts', equals: 'Film' } }),
    ];
    expect(isVisible(multi[1]!, multi, { depts: ['Ops', 'Film'] })).toBe(true);
    expect(isVisible(multi[1]!, multi, { depts: ['Ops'] })).toBe(false);
  });

  it('does not hang on a condition cycle', () => {
    const cyclic: FormField[] = [
      field({ id: 'a', condition: { fieldId: 'b', equals: 'x' } }),
      field({ id: 'b', condition: { fieldId: 'a', equals: 'x' } }),
    ];
    expect(() => isVisible(cyclic[0]!, cyclic, {})).not.toThrow();
  });
});

describe('validation', () => {
  it('requires visible required fields only', () => {
    const fields: FormField[] = [
      field({ id: 'role', type: 'radio', options: ['Designer', 'Editor'] }),
      field({ id: 'portfolio', required: true, condition: { fieldId: 'role', equals: 'Designer' } }),
    ];
    // Hidden, so its required flag must not block submission.
    expect(validateAnswers(fields, { role: 'Editor' })).toEqual({});
    expect(validateAnswers(fields, { role: 'Designer' })).toHaveProperty('portfolio');
  });

  it('checks emails, URLs, numbers and phones', () => {
    const fields: FormField[] = [
      field({ id: 'e', type: 'email' }),
      field({ id: 'u', type: 'url' }),
      field({ id: 'n', type: 'number' }),
      field({ id: 'p', type: 'phone' }),
    ];
    const errors = validateAnswers(fields, {
      e: 'not-an-email', u: 'nope', n: 'abc', p: '!!',
    });
    expect(Object.keys(errors).sort()).toEqual(['e', 'n', 'p', 'u']);

    expect(
      validateAnswers(fields, {
        e: 'a@kmids.ac.th', u: 'https://x.com', n: '42', p: '081-234-5678',
      }),
    ).toEqual({});
  });

  it('ignores layout-only fields', () => {
    const fields = [blankField('section'), blankField('description')];
    fields.forEach((f) => { f.required = true; });
    expect(validateAnswers(fields, {})).toEqual({});
  });

  it('treats an empty array as unanswered', () => {
    const fields = [field({ id: 'c', type: 'checkboxes', required: true, options: ['a'] })];
    expect(validateAnswers(fields, { c: [] })).toHaveProperty('c');
  });
});

describe('answer flattening', () => {
  it('joins multi-select answers', () => {
    expect(answerToText(['Ops', 'Film'])).toBe('Ops; Film');
  });

  it('flattens grid answers', () => {
    expect(answerToText({ 'Row 1': 'Yes', 'Row 2': 'No' })).toBe('Row 1: Yes; Row 2: No');
  });

  it('renders blanks as empty', () => {
    expect(answerToText(null)).toBe('');
  });
});
