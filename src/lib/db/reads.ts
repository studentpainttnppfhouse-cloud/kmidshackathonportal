import 'server-only';
import { asUser } from '@/lib/db/client';
import type { AssignmentStatus, Department, Priority, SessionUser } from '@/lib/types';
import type {
  AnnouncementRow, AssignmentRow, DirectoryUser,
} from '@/lib/rows';

// Re-exported so server components can keep importing everything from one place.
export type {
  AnnouncementRow, AssignmentRow, DeptProgress, DirectoryUser,
} from '@/lib/rows';
export { daysToEvent, isOverdue, summariseByDepartment, todayIso } from '@/lib/rows';

/**
 * Shared reads.
 *
 * Everything here goes through the signed-in user's own token, so the rows
 * that come back are already filtered by RLS. There is no "and also check the
 * tier in JavaScript" step, because that would be a second source of truth
 * that could drift from the policies.
 */

export async function getDepartments(user: SessionUser): Promise<Department[]> {
  const db = asUser(user.id);
  const { data } = await db
    .from('departments')
    .select('id, name, slug, description, head_user_id, color, sort_order')
    .is('deleted_at', null)
    .order('sort_order');
  return (data ?? []) as Department[];
}

const ASSIGNMENT_SELECT = `
  id, title, description, department_id, due_date, priority, status,
  created_by, approved_by, document_id, created_at,
  assignment_assignees ( user_id, users ( nickname, name ) )
`;

interface RawAssignment {
  id: string;
  title: string;
  description: string | null;
  department_id: string | null;
  due_date: string | null;
  priority: Priority;
  status: AssignmentStatus;
  created_by: string | null;
  approved_by: string | null;
  document_id: string | null;
  created_at: string;
  assignment_assignees: {
    user_id: string;
    users: { nickname: string | null; name: string | null } | null;
  }[] | null;
}

function shapeAssignment(row: RawAssignment): AssignmentRow {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    department_id: row.department_id,
    due_date: row.due_date,
    priority: row.priority,
    status: row.status,
    created_by: row.created_by,
    approved_by: row.approved_by,
    document_id: row.document_id,
    created_at: row.created_at,
    assignees: (row.assignment_assignees ?? []).map((a) => ({
      user_id: a.user_id,
      nickname: a.users?.nickname ?? null,
      name: a.users?.name ?? null,
    })),
  };
}

export async function getAssignments(
  user: SessionUser,
  opts: { departmentId?: string | null; mineOnly?: boolean; limit?: number } = {},
): Promise<AssignmentRow[]> {
  const db = asUser(user.id);
  let query = db
    .from('assignments')
    .select(ASSIGNMENT_SELECT)
    .is('deleted_at', null)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(opts.limit ?? 300);

  if (opts.departmentId !== undefined && opts.departmentId !== null) {
    query = query.eq('department_id', opts.departmentId);
  }

  const { data } = await query;
  const rows = ((data ?? []) as unknown as RawAssignment[]).map(shapeAssignment);

  if (opts.mineOnly) {
    return rows.filter((r) => r.assignees.some((a) => a.user_id === user.id));
  }
  return rows;
}

export async function getAnnouncements(
  user: SessionUser,
  limit = 20,
): Promise<AnnouncementRow[]> {
  const db = asUser(user.id);
  const { data } = await db
    .from('announcements')
    .select('id, title, body, scope, department_id, pinned, created_at, users:author_id ( nickname, name )')
    .is('deleted_at', null)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  return ((data ?? []) as unknown as (Omit<AnnouncementRow, 'author'> & {
    users: { nickname: string | null; name: string | null } | null;
  })[]).map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    scope: r.scope,
    department_id: r.department_id,
    pinned: r.pinned,
    created_at: r.created_at,
    author: r.users,
  }));
}

export async function getDirectory(user: SessionUser): Promise<DirectoryUser[]> {
  const db = asUser(user.id);
  const { data } = await db
    .from('users')
    .select(
      'id, email, name, nickname, grade, role_title, department_id, tier, status, is_reserve, is_mentor, is_alumni, avatar_url',
    )
    .is('deleted_at', null)
    .order('tier', { ascending: false })
    .order('nickname');
  return (data ?? []) as DirectoryUser[];
}

