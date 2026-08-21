import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { signedUrlFor } from '@/lib/storage';
import { getDepartments } from '@/lib/db';
import { canCreateContent } from '@/lib/permissions';
import { FilesTabs } from '@/features/files/files-tabs';
import { FilesClient, type LibraryFile } from '@/features/files/files-client';
import { BrandKit } from '@/features/files/brand-kit';

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

  // Stored objects are private, so each row gets a short-lived signed link
  // rather than a permanent public one. The page is force-dynamic, so these
  // are minted fresh on every render and never go stale in a cache.
  const files: LibraryFile[] = await Promise.all(
    ((res.data ?? []) as unknown as Omit<LibraryFile, 'publicUrl'>[]).map(async (f) => ({
      ...f,
      tags: f.tags ?? [],
      publicUrl: f.storage_path ? await signedUrlFor(f.storage_path) : f.external_url,
    })),
  );

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
