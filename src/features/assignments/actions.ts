'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { audit } from '@/lib/audit';
import { assertCanMutate } from '@/lib/permissions';
import { ASSIGNMENT_STATUSES, PRIORITIES } from '@/lib/types';

/**
 * Every mutation follows the same shape: resolve the session, refuse the
 * read-only cases up front, validate with Zod, write through the user's own
 * token so RLS has the final say, then record it in the audit log.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const createSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
  department_id: z.string().uuid().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal('')),
  priority: z.enum(PRIORITIES).default('medium'),
  assignees: z.array(z.string().uuid()).max(20).default([]),
});

export async function createAssignmentAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = createSchema.safeParse({
    title: formData.get('title') ?? '',
    description: formData.get('description') ?? '',
    department_id: (formData.get('department_id') as string) || null,
    due_date: (formData.get('due_date') as string) || null,
    priority: (formData.get('priority') as string) || 'medium',
    assignees: formData.getAll('assignees').filter((v): v is string => typeof v === 'string'),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const v = parsed.data;
  const db = await userClient(user.id);

  const { data, error } = await db
    .from('assignments')
    .insert({
      title: v.title,
      description: v.description || null,
      department_id: v.department_id,
      due_date: v.due_date || null,
      priority: v.priority,
      created_by: user.id,
    })
    .select('id, title')
    .single();

  if (error) return { ok: false, error: friendly(error.message) };

  if (v.assignees.length > 0) {
    await db.from('assignment_assignees').insert(
      v.assignees.map((uid) => ({ assignment_id: data.id, user_id: uid })),
    );
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'assignment.created',
    targetType: 'assignment',
    targetId: data.id,
    targetLabel: data.title,
    diff: { department: v.department_id, due: v.due_date, assignees: v.assignees },
  });

  revalidatePath('/assignments');
  revalidatePath('/dashboard');
  return { ok: true };
}

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(ASSIGNMENT_STATUSES),
});

export async function setAssignmentStatusAction(
  id: string,
  status: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = statusSchema.safeParse({ id, status });
  if (!parsed.success) return { ok: false, error: 'Unknown status' };

  const db = await userClient(user.id);
  const { data: before } = await db
    .from('assignments')
    .select('status, title')
    .eq('id', parsed.data.id)
    .maybeSingle();

  const { data, error } = await db
    .from('assignments')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id)
    .select('id, title')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  // RLS filtered the row out rather than raising — the user simply may not
  // touch this one.
  if (!data) {
    return { ok: false, error: 'You do not have permission to change this task.' };
  }

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: parsed.data.status === 'approved' ? 'assignment.approved' : 'assignment.status_changed',
    targetType: 'assignment',
    targetId: data.id,
    targetLabel: data.title,
    diff: { status: { from: before?.status ?? null, to: parsed.data.status } },
  });

  revalidatePath('/assignments');
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteAssignmentAction(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  try {
    assertCanMutate(user);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = await userClient(user.id);
  // Soft delete — the trigger would catch a hard DELETE too, but being
  // explicit keeps the recycle bin honest.
  const { data, error } = await db
    .from('assignments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, title')
    .maybeSingle();

  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: 'You do not have permission to delete this task.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'assignment.deleted',
    targetType: 'assignment',
    targetId: data.id,
    targetLabel: data.title,
  });

  revalidatePath('/assignments');
  return { ok: true };
}

const commentSchema = z.object({
  parentType: z.enum(['assignment', 'document', 'spreadsheet', 'file', 'content_item']),
  parentId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export async function addCommentAction(
  parentType: string,
  parentId: string,
  body: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Advisors may comment even though they may not do anything else, so this
  // deliberately does not call assertCanMutate.
  if (user.impersonating) {
    return { ok: false, error: 'Impersonation sessions are read-only' };
  }

  const parsed = commentSchema.safeParse({ parentType, parentId, body });
  if (!parsed.success) return { ok: false, error: 'Write something first.' };

  const db = await userClient(user.id);
  const { error } = await db.from('comments').insert({
    parent_type: parsed.data.parentType,
    parent_id: parsed.data.parentId,
    user_id: user.id,
    body: parsed.data.body,
  });

  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath('/assignments');
  return { ok: true };
}

/** Turn a raw Postgres error into something a student can act on. */
function friendly(message: string): string {
  if (message.includes('row-level security')) {
    return 'You do not have permission to do that.';
  }
  if (message.includes('Only a department head')) {
    return 'Only a department head or above can approve an assignment.';
  }
  if (message.includes('read-only') || message.includes('frozen')) {
    return 'That year has been archived and is read-only.';
  }
  return message;
}
