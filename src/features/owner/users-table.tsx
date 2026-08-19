'use client';

import { useMemo, useState, useTransition } from 'react';
import { Ban, RotateCcw, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { TIERS, TIER_META, type Department, type Tier } from '@/lib/types';
import { formatDate } from '@/lib/format';
import {
  banUserAction, removeUserAction, reinstateUserAction, setUserDepartmentAction,
  setUserRoleTitleAction, setUserTierAction, suspendUserAction,
} from './actions';

export interface OwnerUser {
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  tier: Tier;
  department_id: string | null;
  role_title: string | null;
  status: string;
  suspended_until: string | null;
  ban_reason: string | null;
  last_active_at: string | null;
  source_response_id: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  active: '#2DD4BF',
  requested: '#F59E0B',
  pending: '#94A3B8',
  suspended: '#E11D66',
  banned: '#7F1D1D',
};

export function UsersTable({
  users,
  departments,
  currentUserId,
}: {
  users: OwnerUser[];
  departments: Department[];
  currentUserId: string;
}) {
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ kind: 'suspend' | 'ban'; user: OwnerUser } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const deptNames = Object.fromEntries(departments.map((d) => [d.id, d.name]));

  const filtered = useMemo(
    () =>
      users.filter((u) => {
        if (tierFilter && u.tier !== tierFilter) return false;
        if (statusFilter && u.status !== statusFilter) return false;
        if (deptFilter && u.department_id !== deptFilter) return false;
        if (!query) return true;
        return `${u.email} ${u.name ?? ''} ${u.nickname ?? ''} ${u.role_title ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase());
      }),
    [users, query, tierFilter, statusFilter, deptFilter],
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
    });
  }

  function bulk(fn: (id: string) => Promise<{ ok: boolean; error?: string }>) {
    run(async () => {
      for (const id of selected) {
        const res = await fn(id);
        if (!res.ok) return res;
      }
      setSelected(new Set());
      return { ok: true };
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…" aria-label="Search users" className="input pl-9" />
        </div>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
          aria-label="Filter by department" className="input w-auto">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}
          aria-label="Filter by tier" className="input w-auto">
          <option value="">All tiers</option>
          {TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status" className="input w-auto">
          <option value="">Any status</option>
          {['active', 'requested', 'pending', 'suspended', 'banned'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-pink bg-surface-3 px-4 py-2.5">
          <span className="text-[12.5px] font-semibold text-deep">{selected.size} selected</span>
          <select
            aria-label="Set department for selected"
            className="input w-auto py-1.5 text-[12px]"
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value || null;
              bulk((id) => setUserDepartmentAction(id, value));
              e.target.value = '';
            }}
          >
            <option value="" disabled>Change department…</option>
            <option value="">None</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select
            aria-label="Set tier for selected"
            className="input w-auto py-1.5 text-[12px]"
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              if (value) bulk((id) => setUserTierAction(id, value));
              e.target.value = '';
            }}
          >
            <option value="" disabled>Change tier…</option>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
          </select>
          <button type="button" onClick={() => setSelected(new Set())} className="btn-tertiary py-1.5">
            Clear
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-[11.5px] uppercase tracking-[0.03em] text-muted-2">
              <th className="w-9 p-3 pl-4">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  className="h-4 w-4 accent-pink"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(filtered.map((u) => u.id)) : new Set())
                  }
                />
              </th>
              <th className="p-3 font-bold">Person</th>
              <th className="p-3 font-bold">Tier</th>
              <th className="p-3 font-bold">Department</th>
              <th className="p-3 font-bold">Role</th>
              <th className="p-3 font-bold">Status</th>
              <th className="p-3 font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="border-t border-line align-middle">
                  <td className="p-3 pl-4">
                    <input
                      type="checkbox"
                      aria-label={`Select ${u.email}`}
                      className="h-4 w-4 accent-pink"
                      checked={selected.has(u.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(u.id);
                        else next.delete(u.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.nickname ?? u.name ?? u.email} size={32} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {u.nickname ?? u.name ?? '—'}
                          {isSelf ? <span className="ml-1.5 text-[11px] text-muted">(you)</span> : null}
                        </div>
                        <div className="truncate text-[11.5px] text-muted-2">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <select
                      aria-label={`Tier for ${u.email}`}
                      defaultValue={u.tier}
                      disabled={pending}
                      onChange={(e) => run(() => setUserTierAction(u.id, e.target.value))}
                      className="rounded-md border border-line-2 bg-surface px-2 py-1 font-mono text-[12px] font-bold"
                      style={{ color: TIER_META[u.tier].color }}
                    >
                      {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="p-3">
                    <select
                      aria-label={`Department for ${u.email}`}
                      defaultValue={u.department_id ?? ''}
                      disabled={pending}
                      onChange={(e) => run(() => setUserDepartmentAction(u.id, e.target.value || null))}
                      className="max-w-[150px] rounded-md border border-line-2 bg-surface px-2 py-1 text-[12px]"
                    >
                      <option value="">None</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                  <td className="p-3">
                    <input
                      aria-label={`Role title for ${u.email}`}
                      defaultValue={u.role_title ?? ''}
                      disabled={pending}
                      onBlur={(e) => {
                        if (e.target.value !== (u.role_title ?? '')) {
                          run(() => setUserRoleTitleAction(u.id, e.target.value));
                        }
                      }}
                      placeholder="—"
                      className="w-[120px] rounded-md border border-line-2 bg-surface px-2 py-1 text-[12px]"
                    />
                  </td>
                  <td className="p-3">
                    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{
                        color: STATUS_COLOR[u.status] ?? '#94A3B8',
                        background: `color-mix(in srgb, ${STATUS_COLOR[u.status] ?? '#94A3B8'} 15%, transparent)`,
                      }}>
                      {u.status}
                    </span>
                    {u.suspended_until ? (
                      <div className="mt-0.5 text-[10.5px] text-muted">
                        until {formatDate(u.suspended_until)}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      {u.status === 'active' ? (
                        <>
                          <IconAction icon={ShieldAlert} label="Suspend" disabled={isSelf || pending}
                            onClick={() => setDialog({ kind: 'suspend', user: u })} />
                          <IconAction icon={Ban} label="Ban" danger disabled={isSelf || pending}
                            onClick={() => setDialog({ kind: 'ban', user: u })} />
                        </>
                      ) : (
                        <IconAction icon={RotateCcw} label="Reinstate" disabled={pending}
                          onClick={() => run(() => reinstateUserAction(u.id))} />
                      )}
                      <IconAction icon={Trash2} label="Remove" danger disabled={isSelf || pending}
                        onClick={() => {
                          if (confirm(`Remove ${u.email}? Their record is kept for the audit trail.`)) {
                            run(() => removeUserAction(u.id));
                          }
                        }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-10 text-center text-[13px] text-muted-2">
                  Nobody matches those filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {dialog ? (
        <ReasonDialog
          kind={dialog.kind}
          user={dialog.user}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function IconAction({
  icon: Icon, label, onClick, danger, disabled,
}: {
  icon: typeof Ban;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md border border-line-2 transition-colors disabled:opacity-30 ${
        danger ? 'text-muted hover:border-danger hover:text-danger' : 'text-muted hover:border-pink hover:text-ink'
      }`}
    >
      <Icon size={13} />
    </button>
  );
}

function ReasonDialog({
  kind, user, onClose,
}: { kind: 'suspend' | 'ban'; user: OwnerUser; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]" />
      <div role="dialog" aria-modal="true" aria-label={kind === 'ban' ? 'Ban account' : 'Suspend account'}
        className="fixed left-1/2 top-1/2 z-[51] w-[440px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 animate-fadeup rounded-2xl border border-line bg-surface p-6 shadow-raised">
        <div className="mb-1 flex items-center">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">
            {kind === 'ban' ? 'Ban account' : 'Suspend account'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-[12.5px] text-muted-2">
          {user.email} — their sessions are revoked immediately.
        </p>

        <form
          className="flex flex-col gap-3.5"
          action={(fd) => {
            setError(null);
            start(async () => {
              const res = kind === 'ban'
                ? await banUserAction(fd)
                : await suspendUserAction(fd);
              if (res.ok) onClose();
              else setError(res.error);
            });
          }}
        >
          <input type="hidden" name="userId" value={user.id} />

          <div>
            <label className="label" htmlFor="reason">
              Reason * <span className="font-normal">(recorded in the audit log)</span>
            </label>
            <textarea id="reason" name="reason" required rows={3} maxLength={500}
              className="input resize-y" autoFocus />
          </div>

          {kind === 'suspend' ? (
            <div>
              <label className="label" htmlFor="until">Auto-expire on</label>
              <input id="until" name="until" type="date" className="input" />
              <p className="mt-1 text-[11.5px] text-muted">
                Leave blank to suspend until you lift it by hand.
              </p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2.5">
            <button type="submit" disabled={pending}
              className="btn-primary flex-1"
              style={kind === 'ban' ? { background: 'var(--danger)' } : undefined}>
              {pending ? 'Applying…' : kind === 'ban' ? 'Ban account' : 'Suspend account'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
