'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, Plus, Search } from 'lucide-react';

import type { Department, DocStatus } from '@/lib/types';
import { TimeAgo } from '@/components/time-ago';
import { createDocumentAction } from './actions';

export interface LibraryDoc {
  id: string;
  title: string;
  status: DocStatus;
  department_id: string | null;
  updated_at: string;
  owner: string | null;
  tags: string[];
}

const STATUS_LABEL: Record<DocStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#94A3B8' },
  in_review: { label: 'In review', color: '#F59E0B' },
  approved: { label: 'Approved', color: '#2DD4BF' },
  published: { label: 'Published', color: '#22C55E' },
};

export function DocumentLibrary({
  documents,
  departments,
  canCreate,
  defaultDepartmentId,
}: {
  documents: LibraryDoc[];
  departments: Department[];
  canCreate: boolean;
  defaultDepartmentId: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const deptNames = Object.fromEntries(departments.map((d) => [d.id, d.name]));

  const filtered = documents.filter((d) => {
    if (dept && d.department_id !== dept) return false;
    if (status && d.status !== status) return false;
    if (!query) return true;
    return `${d.title} ${d.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase());
  });

  function create() {
    setError(null);
    start(async () => {
      const res = await createDocumentAction('Untitled', defaultDepartmentId);
      if (res.ok && res.data) router.push(`/documents/${res.data.id}`);
      else if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="mx-auto max-w-[1240px] animate-fadeup">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            aria-label="Search documents"
            className="input pl-9"
          />
        </div>

        <select value={dept} onChange={(e) => setDept(e.target.value)}
          aria-label="Filter by department" className="input w-auto min-w-[160px]">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status" className="input w-auto min-w-[140px]">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {canCreate ? (
          <button type="button" onClick={create} disabled={pending} className="btn-primary">
            <Plus size={15} /> {pending ? 'Creating…' : 'New document'}
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
          <FileText size={26} className="mx-auto mb-3 text-muted" />
          <p className="text-[13px] text-muted-2">
            {documents.length === 0 ? 'No documents yet.' : 'Nothing matches those filters.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => {
            const meta = STATUS_LABEL[d.status];
            return (
              <Link key={d.id} href={`/documents/${d.id}`}
                className="card p-4 text-ink transition-colors hover:border-pink">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <FileText size={18} className="text-pink" />
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                    style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}>
                    {meta.label}
                  </span>
                </div>
                <div className="truncate text-[14px] font-semibold">{d.title}</div>
                <div className="mt-1 text-[12px] text-muted-2">
                  {d.department_id ? deptNames[d.department_id] ?? 'General' : 'General'} ·{' '}
                  <TimeAgo iso={d.updated_at} />
                </div>
                {d.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.tags.slice(0, 3).map((t) => (
                      <span key={t} className="mono-tag rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-muted-2">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
