import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { canApprove, canEditOwned, isReadOnly } from '@/lib/permissions';
import type { DocStatus } from '@/lib/types';
import { DocumentEditor } from '@/features/documents/editor';
import { DocMeta } from '@/features/documents/doc-meta';
import { VersionPanel, type DocVersion } from '@/features/documents/version-panel';

export const dynamic = 'force-dynamic';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { id } = await params;
  const db = await userClient(user.id);

  const { data: doc } = await db
    .from('documents')
    .select(
      'id, title, content, plain_text, status, department_id, owner_id, approved_by, tags, departments:department_id ( name ), owner:owner_id ( nickname, name ), approver:approved_by ( nickname, name )',
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  // RLS returns nothing rather than raising when a user may not see a row,
  // so "not found" and "not allowed" look identical here. That is intentional:
  // it does not leak the existence of documents in other departments.
  if (!doc) notFound();

  const row = doc as unknown as {
    id: string;
    title: string;
    content: object;
    plain_text: string;
    status: DocStatus;
    department_id: string | null;
    owner_id: string | null;
    approved_by: string | null;
    departments: { name: string } | null;
    owner: { nickname: string | null; name: string | null } | null;
    approver: { nickname: string | null; name: string | null } | null;
  };

  const { data: versionRows } = await db
    .from('document_versions')
    .select('id, label, created_at, plain_text, users:created_by ( nickname, name )')
    .eq('document_id', id)
    .order('created_at', { ascending: false })
    .limit(30);

  const versions: DocVersion[] = (
    (versionRows ?? []) as unknown as (Omit<DocVersion, 'author'> & {
      users: { nickname: string | null; name: string | null } | null;
    })[]
  ).map((v) => ({
    id: v.id,
    label: v.label,
    created_at: v.created_at,
    plain_text: v.plain_text,
    author: v.users?.nickname ?? v.users?.name ?? null,
  }));

  const editable =
    !isReadOnly(user.effectiveTier) &&
    !user.impersonating &&
    canEditOwned(user, { owner_id: row.owner_id, department_id: row.department_id });

  return (
    <div className="mx-auto max-w-[1240px] animate-fadeup">
      <Link href="/documents" className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-2">
        <ChevronLeft size={15} /> All documents
      </Link>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_300px]">
        <DocumentEditor
          documentId={row.id}
          initialContent={row.content}
          initialTitle={row.title}
          editable={editable}
          me={{ name: user.nickname ?? user.name ?? user.email, email: user.email }}
        />

        <div className="flex flex-col gap-5">
          <DocMeta
            documentId={row.id}
            status={row.status}
            departmentName={row.departments?.name ?? 'General'}
            ownerName={row.owner?.nickname ?? row.owner?.name ?? 'Unknown'}
            approvedBy={row.approver?.nickname ?? row.approver?.name ?? null}
            editable={editable}
            canApprove={canApprove(user, row.department_id)}
          />
          <VersionPanel
            documentId={row.id}
            versions={versions}
            currentText={row.plain_text}
            editable={editable}
          />
        </div>
      </div>
    </div>
  );
}
