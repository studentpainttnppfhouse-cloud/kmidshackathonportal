import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { getDepartments } from '@/lib/db/reads';
import { canManageUsers, canWriteDepartment } from '@/lib/permissions';
import type { FormField, FormSettings } from '@/lib/forms';
import { FormDetail } from '@/features/forms/form-detail';
import type { ResponseRow } from '@/features/forms/responses-table';

export const dynamic = 'force-dynamic';

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { id } = await params;
  const db = await userClient(user.id);

  const { data } = await db
    .from('forms')
    .select('id, title, description, schema, settings, status, public_slug, department_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();

  const form = data as unknown as {
    id: string;
    title: string;
    description: string | null;
    schema: { fields: FormField[] } | null;
    settings: FormSettings | null;
    status: 'draft' | 'published' | 'closed';
    public_slug: string | null;
    department_id: string | null;
  };

  const [{ data: responseRows }, departments] = await Promise.all([
    db
      .from('form_responses')
      .select('id, respondent_email, submitted_at, payload, promoted_user_id')
      .eq('form_id', id)
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false })
      .limit(500),
    getDepartments(user),
  ]);

  const hdrs = await headers();
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const host = hdrs.get('host') ?? 'localhost:3000';

  return (
    <div>
      <Link href="/forms" className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-2">
        <ChevronLeft size={15} /> All forms
      </Link>

      <FormDetail
        formId={form.id}
        title={form.title}
        description={form.description ?? ''}
        fields={form.schema?.fields ?? []}
        settings={form.settings ?? {}}
        status={form.status}
        publicSlug={form.public_slug}
        responses={(responseRows ?? []) as unknown as ResponseRow[]}
        departments={departments}
        canEdit={canWriteDepartment(user, form.department_id) && !user.impersonating}
        canPromote={canManageUsers(user.tier) && !user.impersonating}
        origin={`${proto}://${host}`}
      />
    </div>
  );
}
