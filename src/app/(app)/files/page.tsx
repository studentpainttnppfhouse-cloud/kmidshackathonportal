import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/supabase/user';
import { adminClient } from '@/lib/supabase/admin';
import { getDepartments } from '@/lib/db';
import { canCreateContent } from '@/lib/permissions';
import { FilesTabs } from '@/features/files/files-tabs';
import { FilesClient, type LibraryFile } from '@/features/files/files-client';
import { BrandKit } from '@/features/files/brand-kit';
import { STORAGE_BUCKET } from '@/features/files/constants';

export const dynamic = 'force-dynamic';

export default async function FilesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const db = await userClient(user.id);
  const [departments, res] = await Promise.all([
    getDepartments(user),
    db
      .from('files')
      .select('id, name, mime, size, storage_path, external_url, department_id, tags, is_brand_asset, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(300),
  ]);

  const storage = adminClient().storage.from(STORAGE_BUCKET);

  const files: LibraryFile[] = (
    (res.data ?? []) as unknown as Omit<LibraryFile, 'publicUrl'>[]
  ).map((f) => ({
    ...f,
    tags: f.tags ?? [],
    publicUrl: f.storage_path
      ? storage.getPublicUrl(f.storage_path).data.publicUrl
      : f.external_url,
  }));

  return (
    <FilesTabs
      assets={
        <FilesClient
          files={files}
          departments={departments}
          canUpload={canCreateContent(user, user.department_id)}
          defaultDepartmentId={user.department_id}
        />
      }
      brand={<BrandKit />}
    />
  );
}
