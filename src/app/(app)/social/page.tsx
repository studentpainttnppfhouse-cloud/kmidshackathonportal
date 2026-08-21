import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { getDepartments, getDirectory } from '@/lib/db';
import { canCreateContent } from '@/lib/permissions';
import {
  SocialClient, type ContentItem, type SocialAccount,
} from '@/features/social/social-client';

export const dynamic = 'force-dynamic';

export default async function SocialPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const db = await userClient(user.id);
  const [departments, directory, itemsRes, accountsRes] = await Promise.all([
    getDepartments(user),
    getDirectory(user),
    db
      .from('content_items')
      .select('id, scheduled_date, platform, format, caption, script, status, designer_id, editor_id, poster_id, department_id')
      .is('deleted_at', null)
      .order('scheduled_date'),
    db
      .from('social_accounts')
      .select('id, platform, handle, url, access_holder_user_id, notes')
      .is('deleted_at', null)
      .order('platform'),
  ]);

  return (
    <SocialClient
      items={(itemsRes.data ?? []) as unknown as ContentItem[]}
      accounts={(accountsRes.data ?? []) as unknown as SocialAccount[]}
      people={directory.map((p) => ({ id: p.id, label: p.nickname ?? p.name ?? p.email }))}
      departments={departments}
      canEdit={canCreateContent(user, user.department_id) && !user.impersonating}
      defaultDepartmentId={user.department_id}
    />
  );
}
