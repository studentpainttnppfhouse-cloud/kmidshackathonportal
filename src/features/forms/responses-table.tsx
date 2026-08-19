'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Grid3x3, UserPlus, X } from 'lucide-react';
import { answerToText, type FormField } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { TIERS, type Department } from '@/lib/types';
import { promoteRespondentAction, responsesToSheetAction } from './actions';

export interface ResponseRow {
  id: string;
  respondent_email: string | null;
  submitted_at: string | null;
  payload: Record<string, unknown>;
  promoted_user_id: string | null;
}

export function ResponsesTable({
  formId,
  fields,
  responses,
  departments,
  canPromote,
}: {
  formId: string;
  fields: FormField[];
  responses: ResponseRow[];
  departments: Department[];
  canPromote: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<ResponseRow | null>(null);
  const [promoting, setPromoting] = useState<ResponseRow | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const questions = fields.filter((f) => f.type !== 'section' && f.type !== 'description');

  const filtered = responses.filter((r) => {
    if (!query) return true;
    const hay = `${r.respondent_email ?? ''} ${JSON.stringify(r.payload)}`.toLowerCase();
    return hay.includes(query.toLowerCase());
  });

  function exportCsv() {
    const header = ['Submitted', 'Email', ...questions.map((q) => q.label)];
    const rows = filtered.map((r) => [
      r.submitted_at ? new Date(r.submitted_at).toISOString() : '',
      r.respondent_email ?? '',
      ...questions.map((q) => answerToText(r.payload[q.id] as never)),
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
          .join(','),
      )
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'responses.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search responses…" aria-label="Search responses"
          className="input min-w-[200px] flex-1" />
        <button type="button" onClick={exportCsv} className="btn-secondary">
          <Download size={15} /> Export CSV
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const res = await responsesToSheetAction(formId);
              if (res.ok && res.data) router.push(`/spreadsheets/${res.data.id}`);
              else if (!res.ok) setError(res.error);
            });
          }}
          className="btn-primary"
        >
          <Grid3x3 size={15} /> Send to spreadsheet
        </button>
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-14 text-center">
          <p className="text-[13px] text-muted-2">
            {responses.length === 0 ? 'No responses yet.' : 'Nothing matches that search.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[11.5px] uppercase tracking-[0.03em] text-muted-2">
                <th className="p-3 pl-4 font-bold">Submitted</th>
                <th className="p-3 font-bold">Email</th>
                {questions.slice(0, 3).map((q) => (
                  <th key={q.id} className="p-3 font-bold">{q.label}</th>
                ))}
                <th className="p-3 font-bold" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-line hover:bg-surface-2">
                  <td className="cursor-pointer p-3 pl-4" onClick={() => setDetail(r)}>
                    {formatDateTime(r.submitted_at)}
                  </td>
                  <td className="cursor-pointer p-3 font-semibold" onClick={() => setDetail(r)}>
                    {r.respondent_email ?? '—'}
                  </td>
                  {questions.slice(0, 3).map((q) => (
                    <td key={q.id} className="max-w-[220px] cursor-pointer truncate p-3 text-muted-2"
                      onClick={() => setDetail(r)}>
                      {answerToText(r.payload[q.id] as never) || '—'}
                    </td>
                  ))}
                  <td className="p-3 text-right">
                    {r.promoted_user_id ? (
                      <span className="mono-tag rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-deep">
                        ON STAFF
                      </span>
                    ) : canPromote ? (
                      <button type="button" onClick={() => setPromoting(r)}
                        className="btn-quiet whitespace-nowrap py-1.5">
                        <UserPlus size={13} /> Assign role
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail ? (
        <ResponseDetail response={detail} questions={questions} onClose={() => setDetail(null)} />
      ) : null}

      {promoting ? (
        <PromoteDialog
          response={promoting}
          departments={departments}
          onClose={() => setPromoting(null)}
        />
      ) : null}
    </div>
  );
}

function ResponseDetail({
  response, questions, onClose,
}: { response: ResponseRow; questions: FormField[]; onClose: () => void }) {
  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]" />
      <div role="dialog" aria-modal="true" aria-label="Response"
        className="fixed left-1/2 top-1/2 z-[51] max-h-[86vh] w-[560px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-line bg-surface p-6 shadow-raised">
        <div className="mb-4 flex items-center">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">
            {response.respondent_email ?? 'Anonymous response'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-[12px] text-muted-2">{formatDateTime(response.submitted_at)}</p>
        <dl className="flex flex-col gap-3">
          {questions.map((q) => (
            <div key={q.id}>
              <dt className="text-[12px] font-semibold text-muted-2">{q.label}</dt>
              <dd className="text-[13.5px]">
                {answerToText(response.payload[q.id] as never) || <span className="text-muted">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

function PromoteDialog({
  response, departments, onClose,
}: { response: ResponseRow; departments: Department[]; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]" />
      <div role="dialog" aria-modal="true" aria-label="Assign a role"
        className="fixed left-1/2 top-1/2 z-[51] w-[460px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 animate-fadeup rounded-2xl border border-line bg-surface p-6 shadow-raised">
        <div className="mb-1 flex items-center">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">Assign a role</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Creates their invite and links their staff record back to this application.
        </p>

        <form
          className="flex flex-col gap-3.5"
          action={(fd) => {
            setError(null);
            start(async () => {
              const res = await promoteRespondentAction(fd);
              if (res.ok) onClose();
              else setError(res.error);
            });
          }}
        >
          <input type="hidden" name="responseId" value={response.id} />

          <div>
            <label className="label" htmlFor="promote-email">Email *</label>
            <input id="promote-email" name="email" type="email" required className="input"
              defaultValue={response.respondent_email ?? ''} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="promote-tier">Tier *</label>
              <select id="promote-tier" name="tier" className="input" defaultValue="T1">
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="promote-dept">Department</label>
              <select id="promote-dept" name="departmentId" className="input" defaultValue="">
                <option value="">None</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="promote-role">Role title</label>
            <input id="promote-role" name="roleTitle" maxLength={120} className="input"
              placeholder="Videographer" />
          </div>

          <div>
            <label className="label" htmlFor="promote-notes">Notes</label>
            <textarea id="promote-notes" name="notes" rows={2} maxLength={1000} className="input resize-y" />
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2.5">
            <button type="submit" disabled={pending} className="btn-primary flex-1">
              {pending ? 'Assigning…' : 'Assign role'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
