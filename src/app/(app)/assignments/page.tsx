import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/supabase/user';
import { getAssignments, getDepartments, getDirectory, isOverdue } from '@/lib/db';
import { canApprove, canCreateAssignment, isReadOnly } from '@/lib/permissions';
import { AssignmentsClient } from '@/features/assignments/assignments-client';
import type { DrawerComment } from '@/features/assignments/task-drawer';

export const dynamic = 'force-dynamic';

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; new?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const params = await searchParams;

  const [assignments, departments, directory] = await Promise.all([
    getAssignments(user),
    getDepartments(user),
    getDirectory(user),
  ]);

  const commentsByTask = await loadComments(user, assignments.map((a) => a.id));

  return (
    <AssignmentsClient
      assignments={assignments}
      departments={departments}
      people={directory.map((p) => ({
        id: p.id,
        label: `${p.nickname ?? p.name ?? p.email}${p.role_title ? ` — ${p.role_title}` : ''}`,
      }))}
      currentUserId={user.id}
      canCreate={canCreateAssignment(user, user.department_id)}
      canApprove={canApprove(user, user.department_id)}
      canEdit={!isReadOnly(user.effectiveTier) && !user.impersonating}
      commentsByTask={commentsByTask}
      initialTaskId={params.task}
      overdueCount={assignments.filter(isOverdue).length}
    />
  );
}

async function loadComments(
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  ids: string[],
): Promise<Record<string, DrawerComment[]>> {
  if (ids.length === 0) return {};

  const db = await userClient(user.id);
  const { data } = await db
    .from('comments')
    .select('id, parent_id, body, created_at, users:user_id ( nickname, name )')
    .eq('parent_type', 'assignment')
    .in('parent_id', ids)
    .is('deleted_at', null)
    .order('created_at');

  const out: Record<string, DrawerComment[]> = {};
  for (const row of (data ?? []) as unknown as {
    id: string;
    parent_id: string;
    body: string;
    created_at: string;
    users: { nickname: string | null; name: string | null } | null;
  }[]) {
    const entry: DrawerComment = {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      author: row.users?.nickname ?? row.users?.name ?? 'Staff',
    };
    out[row.parent_id] = [...(out[row.parent_id] ?? []), entry];
  }
  return out;
}
