import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { getDepartments } from '@/lib/db/reads';
import { canCreateContent } from '@/lib/permissions';
import { DocumentLibrary, type LibraryDoc } from '@/features/documents/library';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const db = await userClient(user.id);
  const [departments, res] = await Promise.all([
    getDepartments(user),
    db
      .from('documents')
      .select('id, title, status, department_id, updated_at, tags, users:owner_id ( nickname, name )')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(200),
  ]);

  const documents: LibraryDoc[] = (
    (res.data ?? []) as unknown as (Omit<LibraryDoc, 'owner'> & {
      users: { nickname: string | null; name: string | null } | null;
    })[]
  ).map((d) => ({
    id: d.id,
    title: d.title,
    status: d.status,
    department_id: d.department_id,
    updated_at: d.updated_at,
    tags: d.tags ?? [],
    owner: d.users?.nickname ?? d.users?.name ?? null,
  }));

  return (
    <DocumentLibrary
      documents={documents}
      departments={departments}
      canCreate={canCreateContent(user, user.department_id)}
      defaultDepartmentId={user.department_id}
    />
  );
}
