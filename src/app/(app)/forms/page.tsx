import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db/client';
import { getDepartments } from '@/lib/db/reads';
import { canWriteDepartment } from '@/lib/permissions';
import { FormsHub, type HubForm } from '@/features/forms/forms-hub';

export const dynamic = 'force-dynamic';

export default async function FormsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const db = asUser(user.id);
  const [departments, res] = await Promise.all([
    getDepartments(user),
    db
      .from('forms')
      .select('id, title, status, department_id, public_slug, updated_at, form_responses(count)')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(120),
  ]);

  const forms: HubForm[] = (
    (res.data ?? []) as unknown as (Omit<HubForm, 'responseCount'> & {
      form_responses: { count: number }[] | null;
    })[]
  ).map((f) => ({
    id: f.id,
    title: f.title,
    status: f.status,
    department_id: f.department_id,
    public_slug: f.public_slug,
    updated_at: f.updated_at,
    responseCount: f.form_responses?.[0]?.count ?? 0,
  }));

  return (
    <FormsHub
      forms={forms}
      departments={departments}
      canCreate={canWriteDepartment(user, user.department_id)}
      defaultDepartmentId={user.department_id}
    />
  );
}
