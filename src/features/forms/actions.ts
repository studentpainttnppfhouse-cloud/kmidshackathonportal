'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { admin, asUser } from '@/lib/db/client';
import { asAnon } from '@/lib/db/client';
import { audit } from '@/lib/audit';
import { assertCanMutate, canManageUsers } from '@/lib/permissions';
import { FIELD_TYPES, answerToText, validateAnswers, type FormField } from '@/lib/forms';
import { TIERS } from '@/lib/types';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const conditionSchema = z
  .object({ fieldId: z.string().max(40), equals: z.string().max(200) })
  .nullable()
  .optional();

const fieldSchema: z.ZodType<FormField> = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(FIELD_TYPES),
  label: z.string().max(500),
  help: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().max(200)).max(60).optional(),
  allowOther: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLabel: z.string().max(80).optional(),
  maxLabel: z.string().max(80).optional(),
  rows: z.array(z.string().max(200)).max(40).optional(),
  columns: z.array(z.string().max(200)).max(20).optional(),
  condition: conditionSchema,
});

const saveSchema = z.object({
  title: z.string().trim().min(1, 'Give the form a title').max(200),
  description: z.string().max(2000).optional().nullable(),
  fields: z.array(fieldSchema).max(200),
  settings: z.object({
    confirmationMessage: z.string().max(1000).optional(),
    oneResponsePerUser: z.boolean().optional(),
    allowEditAfterSubmit: z.boolean().optional(),
    loginRequired: z.boolean().optional(),
  }),
});

export async function createFormAction(
  title: string,
  departmentId: string | null,
): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = asUser(user.id);
  const { data, error } = await db
    .from('forms')
    .insert({
      title: title.trim() || 'Untitled form',
      department_id: departmentId,
      owner_id: user.id,
      schema: { fields: [] },
      settings: { loginRequired: true },
    })
    .select('id, title')
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message.includes('row-level security')
        ? 'Only department heads and above can create forms.'
        : error?.message ?? 'Could not create the form.',
    };
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'form.created',
    targetType: 'form',
    targetId: data.id,
    targetLabel: data.title,
  });

  revalidatePath('/forms');
  return { ok: true, data: { id: data.id } };
}

export async function saveFormAction(id: string, payload: unknown): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = saveSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const db = asUser(user.id);
  const { data, error } = await db
    .from('forms')
    .update({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      schema: { fields: parsed.data.fields },
      settings: parsed.data.settings,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'You do not have permission to edit this form.' };

  return { ok: true };
}

export async function setFormStatusAction(
  id: string,
  status: 'draft' | 'published' | 'closed',
): Promise<ActionResult<{ slug: string | null }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = asUser(user.id);
  const patch: Record<string, unknown> = { status };

  // Publishing mints the shareable slug if it does not have one yet.
  if (status === 'published') {
    const { data: existing } = await db
      .from('forms')
      .select('public_slug')
      .eq('id', id)
      .maybeSingle();
    if (!existing?.public_slug) {
      patch.public_slug = `${slugSeed()}-${Math.random().toString(36).slice(2, 7)}`;
    }
  }

  const { data, error } = await db
    .from('forms')
    .update(patch)
    .eq('id', id)
    .select('id, title, public_slug')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'You do not have permission to change this form.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: status === 'published' ? 'form.published' : status === 'closed' ? 'form.closed' : 'form.created',
    targetType: 'form',
    targetId: id,
    targetLabel: data.title,
    diff: { status },
  });

  revalidatePath(`/forms/${id}`);
  revalidatePath('/forms');
  return { ok: true, data: { slug: data.public_slug } };
}

/**
 * Submission. Works logged out when the form allows it, which is why the
 * anonymous client is used in that branch — the `form_responses_insert_anon`
 * policy checks that the form is genuinely published, open and public.
 */
export async function submitResponseAction(
  formId: string,
  answers: Record<string, unknown>,
  respondentEmail?: string,
): Promise<ActionResult> {
  const user = await getSessionUser();

  const { data: form } = await admin()
    .from('forms')
    .select('id, title, schema, settings, status, opens_at, closes_at, department_id')
    .eq('id', formId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!form) return { ok: false, error: 'That form no longer exists.' };

  const row = form as {
    id: string;
    title: string;
    schema: { fields: FormField[] };
    settings: { loginRequired?: boolean; oneResponsePerUser?: boolean };
    status: string;
    opens_at: string | null;
    closes_at: string | null;
  };

  if (row.status !== 'published') return { ok: false, error: 'This form is not accepting responses.' };
  if (row.opens_at && new Date(row.opens_at) > new Date()) {
    return { ok: false, error: 'This form has not opened yet.' };
  }
  if (row.closes_at && new Date(row.closes_at) < new Date()) {
    return { ok: false, error: 'This form has closed.' };
  }
  if (row.settings?.loginRequired && !user) {
    return { ok: false, error: 'You need to sign in to submit this form.' };
  }

  // Validate server-side as well as in the browser — the client check is a
  // convenience, not a guarantee.
  const errors = validateAnswers(row.schema?.fields ?? [], answers as never);
  if (Object.keys(errors).length > 0) {
    return { ok: false, error: 'Some required questions are still blank.' };
  }

  if (row.settings?.oneResponsePerUser && user) {
    const { count } = await admin()
      .from('form_responses')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', formId)
      .eq('user_id', user.id)
      .is('deleted_at', null);
    if ((count ?? 0) > 0) {
      return { ok: false, error: 'You have already responded to this form.' };
    }
  }

  const db = user ? asUser(user.id) : asAnon();
  const { data, error } = await db
    .from('form_responses')
    .insert({
      form_id: formId,
      user_id: user?.id ?? null,
      respondent_email: user?.email ?? respondentEmail ?? null,
      payload: answers,
      submitted_at: new Date().toISOString(),
      is_draft: false,
    })
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Your response could not be saved.' };
  }

  await audit({
    actorId: user?.id ?? null,
    actorEmail: user?.email ?? respondentEmail ?? null,
    action: 'form.response_submitted',
    targetType: 'form',
    targetId: formId,
    targetLabel: row.title,
  });

  return { ok: true };
}

/**
 * Promote a form respondent to a staff member (§4). Creates the invite and
 * links the new user record back to the application they came from.
 */
const promoteSchema = z.object({
  responseId: z.string().uuid(),
  email: z.string().email(),
  tier: z.enum(TIERS),
  departmentId: z.string().uuid().nullable(),
  roleTitle: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function promoteRespondentAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Assigning a role is an Owner act, same as anywhere else in the console.
  if (!canManageUsers(user.tier) || user.impersonating) {
    return { ok: false, error: 'Only the Owner can assign a role.' };
  }

  const parsed = promoteSchema.safeParse({
    responseId: formData.get('responseId'),
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    tier: formData.get('tier'),
    departmentId: (formData.get('departmentId') as string) || null,
    roleTitle: formData.get('roleTitle') ?? undefined,
    notes: formData.get('notes') ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const v = parsed.data;
  const db = admin();

  const { error: inviteError } = await db.from('invited_users').upsert(
    {
      email: v.email,
      tier: v.tier,
      department_id: v.departmentId,
      role_title: v.roleTitle ?? null,
      invited_by: user.id,
      status: 'pending',
    },
    { onConflict: 'email' },
  );

  if (inviteError) return { ok: false, error: inviteError.message };

  // If they already have an account, apply the assignment immediately.
  const { data: existing } = await db
    .from('users')
    .select('id')
    .eq('email', v.email)
    .maybeSingle();

  if (existing) {
    await db
      .from('users')
      .update({
        tier: v.tier,
        department_id: v.departmentId,
        role_title: v.roleTitle ?? null,
        status: 'active',
        source_response_id: v.responseId,
      })
      .eq('id', existing.id);
  }

  await db
    .from('form_responses')
    .update({ promoted_user_id: existing?.id ?? null, promoted_notes: v.notes ?? null })
    .eq('id', v.responseId);

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'form.response_promoted',
    targetType: 'form_response',
    targetId: v.responseId,
    targetLabel: v.email,
    diff: { tier: v.tier, department: v.departmentId, role: v.roleTitle },
  });

  revalidatePath('/forms');
  revalidatePath('/owner');
  return { ok: true };
}

/** Push responses into a live-linked spreadsheet (§5.8). */
export async function responsesToSheetAction(formId: string): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = asUser(user.id);
  const { data: form } = await db
    .from('forms')
    .select('id, title, schema, department_id')
    .eq('id', formId)
    .maybeSingle();

  if (!form) return { ok: false, error: 'Form not found.' };

  const row = form as {
    id: string;
    title: string;
    schema: { fields: FormField[] };
    department_id: string | null;
  };

  const { data: responses } = await db
    .from('form_responses')
    .select('respondent_email, payload, submitted_at')
    .eq('form_id', formId)
    .is('deleted_at', null)
    .order('submitted_at');

  const questions = (row.schema?.fields ?? []).filter(
    (f) => f.type !== 'section' && f.type !== 'description',
  );

  const cells: Record<string, string> = {};
  const header = ['Submitted', 'Email', ...questions.map((q) => q.label)];
  header.forEach((h, i) => {
    cells[`${colName(i)}1`] = h;
  });

  (responses ?? []).forEach((resp, r) => {
    const payload = (resp.payload ?? {}) as Record<string, unknown>;
    const values = [
      resp.submitted_at ? new Date(resp.submitted_at).toLocaleString('en-GB') : '',
      resp.respondent_email ?? '',
      ...questions.map((q) => answerToText(payload[q.id] as never)),
    ];
    values.forEach((v, c) => {
      if (v) cells[`${colName(c)}${r + 2}`] = v;
    });
  });

  const { data: sheet, error } = await db
    .from('spreadsheets')
    .insert({
      title: `${row.title} — responses`,
      department_id: row.department_id,
      owner_id: user.id,
      source_form_id: formId,
      data: { cells, formats: {}, rows: Math.max(60, (responses?.length ?? 0) + 10), cols: Math.max(16, header.length + 2) },
    })
    .select('id')
    .maybeSingle();

  if (error || !sheet) {
    return { ok: false, error: error?.message ?? 'Could not create the spreadsheet.' };
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'spreadsheet.created',
    targetType: 'spreadsheet',
    targetId: sheet.id,
    targetLabel: `${row.title} — responses`,
    diff: { from_form: formId, rows: responses?.length ?? 0 },
  });

  return { ok: true, data: { id: sheet.id } };
}

function colName(index: number): string {
  let n = index;
  let name = '';
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

function slugSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}
