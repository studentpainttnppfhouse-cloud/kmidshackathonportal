import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { getAnnouncements, getAssignments, getDepartments, getDirectory } from '@/lib/db/reads';
import { canPublishAnnouncement } from '@/lib/permissions';
import {
  WorkspaceClient, type WorkspaceDoc, type WorkspaceFile,
} from '@/features/workspace/workspace-client';

export const dynamic = 'force-dynamic';

/**
 * Six department spaces plus a General space visible to everyone (§5.4).
 * Which space you land on defaults to your own department.
 */
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; tab?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const params = await searchParams;
  const departments = await getDepartments(user);

  const active = params.dept
    ? departments.find((d) => d.slug === params.dept) ?? null
    : departments.find((d) => d.id === user.department_id) ?? null;

  const db = await userClient(user.id);

  const [assignments, announcements, directory, docsRes, filesRes] = await Promise.all([
    getAssignments(user, { departmentId: active?.id ?? null }),
    getAnnouncements(user, 30),
    getDirectory(user),
    db
      .from('documents')
      .select('id, title, status, updated_at, users:owner_id ( nickname, name )')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(60),
    db
      .from('files')
      .select('id, name, mime, size, created_at, department_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

  const documents: WorkspaceDoc[] = (
    (docsRes.data ?? []) as unknown as {
      id: string;
      title: string;
      status: string;
      updated_at: string;
      department_id?: string | null;
      users: { nickname: string | null; name: string | null } | null;
    }[]
  ).map((d) => ({
    id: d.id,
    title: d.title,
    status: d.status,
    updated_at: d.updated_at,
    owner: d.users?.nickname ?? d.users?.name ?? null,
  }));

  const files: WorkspaceFile[] = (
    (filesRes.data ?? []) as unknown as (WorkspaceFile & { department_id: string | null })[]
  ).filter((f) => f.department_id === (active?.id ?? null));

  const scopedAnnouncements = announcements.filter((a) =>
    active ? a.department_id === active.id || a.scope === 'all' : a.scope === 'all' || a.department_id === null,
  );

  return (
    <WorkspaceClient
      departments={departments}
      active={active}
      assignments={assignments}
      documents={documents}
      files={files}
      announcements={scopedAnnouncements}
      members={directory.filter((p) => p.department_id === (active?.id ?? null))}
      canPost={canPublishAnnouncement(user, 'department', active?.id ?? null)}
      canPostAll={canPublishAnnouncement(user, 'all', null)}
    />
  );
}
