import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/supabase/user';
import { canEditOwned, isReadOnly } from '@/lib/permissions';
import { emptySheet, type SheetData } from '@/lib/sheet';
import { SheetGrid } from '@/features/spreadsheets/grid';
import { SheetHeader } from '@/features/spreadsheets/sheet-header';

export const dynamic = 'force-dynamic';

export default async function SpreadsheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { id } = await params;
  const db = await userClient(user.id);

  const { data } = await db
    .from('spreadsheets')
    .select('id, title, data, department_id, owner_id, departments:department_id ( name )')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();

  const row = data as unknown as {
    id: string;
    title: string;
    data: SheetData | null;
    department_id: string | null;
    owner_id: string | null;
    departments: { name: string } | null;
  };

  const editable =
    !isReadOnly(user.effectiveTier) &&
    !user.impersonating &&
    canEditOwned(user, { owner_id: row.owner_id, department_id: row.department_id });

  const sheet: SheetData = {
    ...emptySheet(),
    ...(row.data ?? {}),
    cells: row.data?.cells ?? {},
    formats: row.data?.formats ?? {},
  };

  return (
    <div className="mx-auto max-w-[1400px] animate-fadeup">
      <Link href="/spreadsheets" className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-muted-2">
        <ChevronLeft size={15} /> All spreadsheets
      </Link>

      <SheetHeader
        sheetId={row.id}
        title={row.title}
        departmentName={row.departments?.name ?? 'General'}
        editable={editable}
      />

      <SheetGrid sheetId={row.id} initialData={sheet} editable={editable} />
    </div>
  );
}
