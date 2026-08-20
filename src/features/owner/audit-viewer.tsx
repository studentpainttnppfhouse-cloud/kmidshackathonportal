'use client';

import { useMemo, useState } from 'react';
import { Download, Lock, Search } from 'lucide-react';
import { formatDateTime } from '@/lib/format';

export interface AuditRow {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_label: string | null;
  diff: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

/**
 * The audit log is read-only for everyone, the Owner included — there is no
 * edit or delete affordance here because the database refuses both.
 */
export function AuditViewer({ rows }: { rows: AuditRow[] }) {
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const actions = useMemo(
    () => [...new Set(rows.map((r) => r.action))].sort(),
    [rows],
  );
  const targets = useMemo(
    () => [...new Set(rows.map((r) => r.target_type).filter(Boolean))].sort() as string[],
    [rows],
  );

  const filtered = rows.filter((r) => {
    if (action && r.action !== action) return false;
    if (target && r.target_type !== target) return false;
    if (from && r.created_at < from) return false;
    // `to` is a date; compare against the end of that day.
    if (to && r.created_at > `${to}T23:59:59.999Z`) return false;
    if (!query) return true;
    return `${r.actor_email ?? ''} ${r.action} ${r.target_label ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });

  function exportCsv() {
    const header = ['Timestamp', 'Actor', 'Action', 'Target type', 'Target', 'IP', 'Diff'];
    const body = filtered.map((r) => [
      r.created_at,
      r.actor_email ?? '',
      r.action,
      r.target_type ?? '',
      r.target_label ?? '',
      r.ip ?? '',
      r.diff ? JSON.stringify(r.diff) : '',
    ]);
    const csv = [header, ...body]
      .map((row) =>
        row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','),
      )
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5">
        <Lock size={14} className="text-muted-2" />
        <p className="text-[12.5px] text-muted-2">
          Append-only. No user — including you — can edit or delete these rows.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actor or target…" aria-label="Search the audit log" className="input pl-9" />
        </div>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action" className="input w-auto">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={target} onChange={(e) => setTarget(e.target.value)}
          aria-label="Filter by target type" className="input w-auto">
          <option value="">All targets</option>
          {targets.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div>
          <label className="label" htmlFor="audit-from">From</label>
          <input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="input w-auto" />
        </div>
        <div>
          <label className="label" htmlFor="audit-to">To</label>
          <input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="input w-auto" />
        </div>
        <button type="button" onClick={exportCsv} className="btn-secondary">
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-[11.5px] uppercase tracking-[0.03em] text-muted-2">
              <th className="p-3 pl-4 font-bold">When</th>
              <th className="p-3 font-bold">Actor</th>
              <th className="p-3 font-bold">Action</th>
              <th className="p-3 font-bold">Target</th>
              <th className="p-3 font-bold">IP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}
                onClick={() => setOpen(open === r.id ? null : r.id)}
                className="cursor-pointer border-t border-line hover:bg-surface-2">
                <td className="whitespace-nowrap p-3 pl-4 font-mono text-[12px] text-muted-2">
                  {formatDateTime(r.created_at)}
                </td>
                <td className="p-3">{r.actor_email ?? <span className="text-muted">system</span>}</td>
                <td className="p-3">
                  <span className="mono-tag rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-deep">
                    {r.action}
                  </span>
                </td>
                <td className="max-w-[240px] truncate p-3 text-muted-2">
                  {r.target_label ?? r.target_type ?? '—'}
                  {open === r.id && r.diff ? (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 font-mono text-[11px] text-ink">
                      {JSON.stringify(r.diff, null, 2)}
                    </pre>
                  ) : null}
                </td>
                <td className="p-3 font-mono text-[11.5px] text-muted">{r.ip ?? '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-10 text-center text-[13px] text-muted-2">
                  Nothing matches those filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[12px] text-muted-2">
        Showing {filtered.length} of {rows.length} entries.
      </p>
    </div>
  );
}
