'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, Plus } from 'lucide-react';

import type { Department } from '@/lib/types';
import { TimeAgo } from '@/components/time-ago';
import { createFormAction } from './actions';

export interface HubForm {
  id: string;
  title: string;
  status: 'draft' | 'published' | 'closed';
  department_id: string | null;
  public_slug: string | null;
  updated_at: string;
  responseCount: number;
}

const STATUS: Record<HubForm['status'], { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#94A3B8' },
  published: { label: 'Open', color: '#2DD4BF' },
  closed: { label: 'Closed', color: '#E11D66' },
};

export function FormsHub({
  forms,
  departments,
  canCreate,
  defaultDepartmentId,
}: {
  forms: HubForm[];
  departments: Department[];
  canCreate: boolean;
  defaultDepartmentId: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const deptNames = Object.fromEntries(departments.map((d) => [d.id, d.name]));

  return (
    <div className="mx-auto max-w-[1240px] animate-fadeup">
      <div className="mb-5 flex items-center gap-3">
        <h2 className="text-[15px] font-bold">All forms</h2>
        <div className="flex-1" />
        {canCreate ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await createFormAction('Untitled form', defaultDepartmentId);
                if (res.ok && res.data) router.push(`/forms/${res.data.id}`);
                else if (!res.ok) setError(res.error);
              });
            }}
            className="btn-primary"
          >
            <Plus size={15} /> {pending ? 'Creating…' : 'New form'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {forms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-16 text-center">
          <ClipboardList size={26} className="mx-auto mb-3 text-muted" />
          <p className="text-[13px] text-muted-2">No forms yet.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((f) => {
            const meta = STATUS[f.status];
            return (
              <Link key={f.id} href={`/forms/${f.id}`}
                className="card p-4 text-ink transition-colors hover:border-pink">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <ClipboardList size={18} className="text-pink" />
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                    style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}>
                    {meta.label}
                  </span>
                </div>
                <div className="truncate text-[14px] font-semibold">{f.title}</div>
                <div className="mt-1 text-[12px] text-muted-2">
                  {f.department_id ? deptNames[f.department_id] ?? 'General' : 'General'} ·{' '}
                  <TimeAgo iso={f.updated_at} />
                </div>
                <div className="mt-2 text-[12.5px] font-semibold text-deep">
                  {f.responseCount} {f.responseCount === 1 ? 'response' : 'responses'}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
