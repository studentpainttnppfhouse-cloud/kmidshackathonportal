'use client';

import { useState, useTransition } from 'react';
import { Archive, Eye, KeyRound, ScrollText, Users } from 'lucide-react';
import { TIERS, type Department, type Tier } from '@/lib/types';
import { setViewAsAction } from '@/components/shell/impersonation';
import { UsersTable, type OwnerUser } from './users-table';
import { InvitesPanel, type InviteKey, type PendingInvite } from './invites-panel';
import { AuditViewer, type AuditRow } from './audit-viewer';
import { setArchiveFrozenAction, transferOwnershipAction } from './actions';

type Tab = 'users' | 'invites' | 'audit' | 'system';

export function OwnerConsole({
  users,
  requests,
  invites,
  keys,
  auditRows,
  departments,
  currentUserId,
  frozenYears,
}: {
  users: OwnerUser[];
  requests: OwnerUser[];
  invites: PendingInvite[];
  keys: InviteKey[];
  auditRows: AuditRow[];
  departments: Department[];
  currentUserId: string;
  frozenYears: number[];
}) {
  const [tab, setTab] = useState<Tab>('users');

  const tabs: { key: Tab; label: string; icon: typeof Users; badge?: number }[] = [
    { key: 'users', label: 'Users', icon: Users },
    { key: 'invites', label: 'Invites & requests', icon: KeyRound, badge: requests.length },
    { key: 'audit', label: 'Audit log', icon: ScrollText },
    { key: 'system', label: 'System', icon: Archive },
  ];

  return (
    <div className="mx-auto max-w-[1400px] animate-fadeup">
      <div className="mb-5 flex gap-5 overflow-x-auto border-b border-line">
        {tabs.map(({ key, label, icon: Icon, badge }) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 py-3 text-[13.5px] transition-colors ${
              tab === key
                ? 'border-pink font-bold text-deep'
                : 'border-transparent font-medium text-muted-2 hover:text-ink'
            }`}>
            <Icon size={14} />
            {label}
            {badge ? (
              <span className="rounded-full bg-pink px-1.5 text-[11px] font-bold text-white">
                {badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'users' ? (
        <UsersTable users={users} departments={departments} currentUserId={currentUserId} />
      ) : null}

      {tab === 'invites' ? (
        <InvitesPanel invites={invites} keys={keys} requests={requests} departments={departments} />
      ) : null}

      {tab === 'audit' ? <AuditViewer rows={auditRows} /> : null}

      {tab === 'system' ? (
        <SystemPanel
          users={users}
          currentUserId={currentUserId}
          frozenYears={frozenYears}
        />
      ) : null}
    </div>
  );
}

function SystemPanel({
  users, currentUserId, frozenYears,
}: { users: OwnerUser[]; currentUserId: string; frozenYears: number[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const owners = users.filter((u) => u.tier === 'T4');
  const candidates = users.filter(
    (u) => u.tier !== 'T4' && u.status === 'active' && u.id !== currentUserId,
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Something went wrong.');
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-bold">
          <Eye size={16} className="text-pink" /> Preview as another tier
        </h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          See exactly what a given tier sees, so you can verify the permission model
          yourself. The preview is read-only and every start and stop is audited.
        </p>
        <div className="flex flex-wrap gap-2">
          {TIERS.filter((t) => t !== 'T4').map((t) => (
            <button key={t} type="button" disabled={pending} className="btn-quiet"
              onClick={() => start(() => setViewAsAction(t as Tier))}>
              View as {t}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[14px] font-bold">Ownership</h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Two Owners always exist so that one graduating student is never a single point
          of failure. You cannot remove the last one.
        </p>

        <div className="mb-4">
          <div className="label">Current Owners</div>
          <ul className="flex flex-wrap gap-2">
            {owners.map((o) => (
              <li key={o.id} className="rounded-md bg-surface-3 px-2.5 py-1.5 text-[12.5px] font-semibold text-deep">
                {o.nickname ?? o.name ?? o.email}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-[220px] flex-1">
            <label className="label" htmlFor="transfer-to">Promote to Owner</label>
            <select id="transfer-to" className="input" defaultValue="">
              <option value="">Choose a person…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nickname ?? c.name ?? c.email} — {c.email}
                </option>
              ))}
            </select>
          </div>
          <button type="button" disabled={pending} className="btn-primary"
            onClick={() => {
              const select = document.getElementById('transfer-to') as HTMLSelectElement | null;
              const id = select?.value;
              if (!id) {
                setError('Choose someone first.');
                return;
              }
              const label = select?.options[select.selectedIndex]?.text ?? 'this person';
              if (confirm(`Make ${label} an Owner? They gain full access including this console.`)) {
                run(() => transferOwnershipAction(id));
              }
            }}>
            Transfer ownership
          </button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-bold">
          <Archive size={16} className="text-pink" /> Archive
        </h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Freezing a year makes every piece of content for it read-only at the database
          level, not just in the interface. Next year&rsquo;s team can still browse it.
        </p>

        <div className="flex flex-wrap gap-2">
          {[2026, 2027].map((year) => {
            const frozen = frozenYears.includes(year);
            return (
              <button key={year} type="button" disabled={pending}
                className={frozen ? 'btn-secondary' : 'btn-quiet'}
                onClick={() => {
                  const verb = frozen ? 'Unfreeze' : 'Freeze';
                  if (confirm(`${verb} ${year}? ${frozen ? 'Content becomes editable again.' : 'All content for that year becomes read-only.'}`)) {
                    run(() => setArchiveFrozenAction(year, !frozen));
                  }
                }}>
                {frozen ? `${year} — frozen (click to unfreeze)` : `Freeze ${year}`}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[14px] font-bold">Full export</h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Every table as JSON, plus a manifest of stored files. Downloading is audited.
        </p>
        <a href="/api/export" className="btn-primary self-start">Download full export</a>
      </section>
    </div>
  );
}
