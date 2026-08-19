'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Grid3x3, Plus, Search } from 'lucide-react';

import type { Department } from '@/lib/types';
import { TimeAgo } from '@/components/time-ago';
import { createSheetAction } from './actions';

export interface LibrarySheet {
  id: string;
  title: string;
  department_id: string | null;
  updated_at: string;
  owner: string | null;
  source_form_id: string | null;
}

export function SheetLibrary({
  sheets,
  departments,
  canCreate,
  defaultDepartmentId,
}: {
  sheets: LibrarySheet[];
  departments: Department[];
  canCreate: boolean;
  defaultDepartmentId: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const deptNames = Object.fromEntries(departments.map((d) => [d.id, d.name]));
  const filtered = sheets.filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-[1240px] animate-fadeup">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search spreadsheets…" aria-label="Search spreadsheets" className="input pl-9" />
        </div>
        {canCreate ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await createSheetAction('Untitled sheet', defaultDepartmentId);
                if (res.ok && res.data) router.push(`/spreadsheets/${res.data.id}`);
                else if (!res.ok) setError(res.error);
              });
            }}
            className="btn-primary"
          >
            <Plus size={15} /> {pending ? 'Creating…' : 'New spreadsheet'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-16 text-center">
          <Grid3x3 size={26} className="mx-auto mb-3 text-muted" />
          <p className="text-[13px] text-muted-2">
            {sheets.length === 0 ? 'No spreadsheets yet.' : 'Nothing matches that search.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Link key={s.id} href={`/spreadsheets/${s.id}`}
              className="card p-4 text-ink transition-colors hover:border-pink">
              <Grid3x3 size={18} className="mb-2 text-pink" />
              <div className="truncate text-[14px] font-semibold">{s.title}</div>
              <div className="mt-1 text-[12px] text-muted-2">
                {s.department_id ? deptNames[s.department_id] ?? 'General' : 'General'} ·{' '}
                <TimeAgo iso={s.updated_at} />
              </div>
              {s.source_form_id ? (
                <span className="mono-tag mt-2 inline-block rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-deep">
                  LINKED TO FORM
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
