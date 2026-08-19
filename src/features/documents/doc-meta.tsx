'use client';

import { useState, useTransition } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DOC_STATUSES, type DocStatus } from '@/lib/types';
import { deleteDocumentAction, setDocumentStatusAction } from './actions';

const LABEL: Record<DocStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  published: 'Published',
};

export function DocMeta({
  documentId,
  status,
  departmentName,
  ownerName,
  approvedBy,
  editable,
  canApprove,
}: {
  documentId: string;
  status: DocStatus;
  departmentName: string;
  ownerName: string;
  approvedBy: string | null;
  editable: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="card p-5">
      <h2 className="mb-3.5 text-[14px] font-bold">Document</h2>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-muted-2">Department</dt>
        <dd className="font-semibold">{departmentName}</dd>
        <dt className="text-muted-2">Owner</dt>
        <dd className="font-semibold">{ownerName}</dd>
        {approvedBy ? (
          <>
            <dt className="text-muted-2">Approved by</dt>
            <dd className="font-semibold text-teal">{approvedBy}</dd>
          </>
        ) : null}
      </dl>

      {editable ? (
        <div className="mt-4">
          <label className="label" htmlFor="doc-status">Status</label>
          <select
            id="doc-status"
            defaultValue={status}
            disabled={pending}
            className="input"
            onChange={(e) => {
              const next = e.target.value;
              setError(null);
              start(async () => {
                const res = await setDocumentStatusAction(documentId, next);
                if (!res.ok) setError(res.error);
              });
            }}
          >
            {DOC_STATUSES.map((s) => (
              <option
                key={s}
                value={s}
                // Only T2+ may mark something Approved, same as assignments.
                disabled={s === 'approved' && !canApprove}
              >
                {LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="mt-4 text-[13px]">
          <span className="text-muted-2">Status: </span>
          <span className="font-semibold">{LABEL[status]}</span>
        </p>
      )}

      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        <a href={`/api/documents/${documentId}/export?format=docx`} className="btn-quiet justify-start">
          <Download size={14} /> Export as .docx
        </a>
        <a href={`/api/documents/${documentId}/export?format=pdf`} className="btn-quiet justify-start">
          <Download size={14} /> Export as PDF
        </a>
      </div>

      {editable ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm('Move this document to the recycle bin?')) return;
            start(async () => {
              const res = await deleteDocumentAction(documentId);
              if (res.ok) router.push('/documents');
              else setError(res.error);
            });
          }}
          className="mt-4 flex items-center gap-1.5 text-[12.5px] font-semibold text-danger"
        >
          <Trash2 size={13} /> Delete document
        </button>
      ) : null}
    </section>
  );
}
