import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db/client';
import { getDepartments } from '@/lib/db/reads';
import { canCreateContent } from '@/lib/permissions';
import { FilesTabs } from '@/features/files/files-tabs';
import { FilesClient, type LibraryFile } from '@/features/files/files-client';
import { BrandKit } from '@/features/files/brand-kit';
import { downloadPath } from '@/lib/files/storage';

export const dynamic = 'force-dynamic';

export default async function FilesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const db = asUser(user.id);
  const [departments, res] = await Promise.all([
    getDepartments(user),
    db
      .from('files')
      .select('id, name, mime, size, storage_path, external_url, department_id, tags, is_brand_asset, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(300),
  ]);

  // An uploaded file is served by the app itself, so that the department rules
  // apply to the bytes and not only to this listing. An external link is left
  // exactly as it was given.
  const files: LibraryFile[] = (
    (res.data ?? []) as unknown as Omit<LibraryFile, 'publicUrl'>[]
  ).map((f) => ({
    ...f,
    tags: f.tags ?? [],
    publicUrl: f.storage_path ? downloadPath(f.id) : f.external_url,
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
