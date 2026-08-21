/**
 * Row shapes and pure helpers.
 *
 * Deliberately free of `server-only` and of any database import, because the
 * board, list, calendar and drawer are all client components and need these
 * types and predicates too. The functions that actually talk to the database
 * live in src/lib/db.ts.
 */
import type {
  AssignmentStatus, Department, Priority, Tier,
} from './types';

export interface AssignmentRow {
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
  assignees: { user_id: string; nickname: string | null; name: string | null }[];
}

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  scope: 'all' | 'department';
  department_id: string | null;
  pinned: boolean;
  created_at: string;
  author: { nickname: string | null; name: string | null } | null;
}

export interface DirectoryUser {
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  grade: string | null;
  role_title: string | null;
  department_id: string | null;
  tier: Tier;
  status: string;
  is_reserve: boolean;
  is_mentor: boolean;
  is_alumni: boolean;
  avatar_url: string | null;
}

export interface DeptProgress extends Department {
  done: number;
  total: number;
  pct: number;
  overdue: number;
}

/** Today in ISO date form, in the browser's or server's local zone. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalise a date value to a bare `YYYY-MM-DD`.
 *
 * A `date` column comes back as "2027-03-20" from PostgREST, but anything that
 * round-trips through a JS Date arrives as a full ISO timestamp. Both appear in
 * practice, and the string comparisons below are only correct for the first
 * form — so everything goes through here rather than trusting the shape.
 */
export function asIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function isOverdue(a: Pick<AssignmentRow, 'due_date' | 'status'>): boolean {
  const due = asIsoDate(a.due_date);
  if (!due) return false;
  if (a.status === 'done' || a.status === 'approved') return false;
  return due < todayIso();
}

export function summariseByDepartment(
  departments: Department[],
  assignments: AssignmentRow[],
): DeptProgress[] {
  const today = todayIso();

  return departments.map((d) => {
    const mine = assignments.filter((a) => a.department_id === d.id);
    const done = mine.filter((a) => a.status === 'done' || a.status === 'approved').length;
    const overdue = mine.filter((a) => {
      const due = asIsoDate(a.due_date);
      return (
        due !== null && due < today && a.status !== 'done' && a.status !== 'approved'
      );
    }).length;
    const total = mine.length;
    return {
      ...d,
      done,
      total,
      pct: total === 0 ? 0 : Math.round((done / total) * 100),
      overdue,
    };
  });
}

/** Days until the event. Clamped at zero once it has started. */
export function daysToEvent(from: Date = new Date()): number {
  const target = new Date('2027-03-20T00:00:00Z').getTime();
  const diff = Math.ceil((target - from.getTime()) / 86_400_000);
  return diff > 0 ? diff : 0;
}
