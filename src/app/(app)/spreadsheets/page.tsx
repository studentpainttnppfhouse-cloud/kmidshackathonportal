import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { getDepartments } from '@/lib/db';
import { canCreateContent } from '@/lib/permissions';
import { SheetLibrary, type LibrarySheet } from '@/features/spreadsheets/library';

export const dynamic = 'force-dynamic';

export default async function SpreadsheetsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const db = await userClient(user.id);
  const [departments, res] = await Promise.all([
    getDepartments(user),
    db
      .from('spreadsheets')
      .select('id, title, department_id, updated_at, source_form_id, users:owner_id ( nickname, name )')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(200),
  ]);

  const sheets: LibrarySheet[] = (
    (res.data ?? []) as unknown as (Omit<LibrarySheet, 'owner'> & {
      users: { nickname: string | null; name: string | null } | null;
    })[]
  ).map((s) => ({
    id: s.id,
    title: s.title,
    department_id: s.department_id,
    updated_at: s.updated_at,
    source_form_id: s.source_form_id,
    owner: s.users?.nickname ?? s.users?.name ?? null,
  }));

  return (
    <SheetLibrary
      sheets={sheets}
      departments={departments}
      canCreate={canCreateContent(user, user.department_id)}
      defaultDepartmentId={user.department_id}
    />
  );
}
