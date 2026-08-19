'use client';

import { useState, useTransition } from 'react';
import { Copy, KeyRound, Mail, Trash2, UserCheck, UserX } from 'lucide-react';
import { TIERS, TIER_META, type Department, type Tier } from '@/lib/types';
import { formatDate } from '@/lib/format';
import {
  approveRequestAction, createInviteKeyAction, rejectRequestAction,
  revokeInviteAction, revokeInviteKeyAction, sendInvitesAction,
} from './actions';
import type { OwnerUser } from './users-table';

export interface PendingInvite {
  id: string;
  email: string;
  tier: Tier;
  department_id: string | null;
  role_title: string | null;
  status: string;
  created_at: string;
}

export interface InviteKey {
  id: string;
  code: string;
  label: string | null;
  tier: Tier;
  department_id: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
}

export function InvitesPanel({
  invites,
  keys,
  requests,
  departments,
}: {
  invites: PendingInvite[];
  keys: InviteKey[];
  requests: OwnerUser[];
  departments: Department[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const deptNames = Object.fromEntries(departments.map((d) => [d.id, d.name]));

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

      {/* Access-request queue (§4C) */}
      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-bold">
          <UserCheck size={16} className="text-pink" />
          Pending access requests
          {requests.length > 0 ? (
            <span className="rounded-full bg-pink px-2 py-0.5 text-[11px] font-bold text-white">
              {requests.length}
            </span>
          ) : null}
        </h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Signed in with a school address but not on any list. They see a waiting screen
          and can reach nothing until you decide.
        </p>

        {requests.length === 0 ? (
          <p className="py-3 text-[13px] text-muted-2">Nobody waiting.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line p-3">
                <div className="min-w-[180px] flex-1">
                  <div className="text-[13px] font-semibold">{r.name ?? r.email}</div>
                  <div className="text-[11.5px] text-muted-2">{r.email}</div>
                </div>
                <select id={`tier-${r.id}`} aria-label={`Tier for ${r.email}`}
                  className="input w-auto py-1.5 text-[12px]" defaultValue="T1">
                  {TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
                </select>
                <select id={`dept-${r.id}`} aria-label={`Department for ${r.email}`}
                  className="input w-auto py-1.5 text-[12px]" defaultValue="">
                  <option value="">No department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button type="button" disabled={pending} className="btn-primary py-1.5"
                  onClick={() => {
                    const tier = (document.getElementById(`tier-${r.id}`) as HTMLSelectElement)?.value ?? 'T1';
                    const dept = (document.getElementById(`dept-${r.id}`) as HTMLSelectElement)?.value || null;
                    run(() => approveRequestAction(r.id, tier, dept));
                  }}>
                  Approve
                </button>
                <button type="button" disabled={pending} className="btn-secondary py-1.5"
                  onClick={() => {
                    if (confirm(`Reject ${r.email}?`)) run(() => rejectRequestAction(r.id));
                  }}>
                  <UserX size={13} /> Reject
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Direct invite (§4A) */}
      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-bold">
          <Mail size={16} className="text-pink" /> Invite people
        </h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Paste as many addresses as you like, separated by commas, spaces or new lines.
          They get the tier and department below the moment they first sign in.
        </p>

        <form
          className="flex flex-col gap-3.5"
          action={(fd) => {
            setError(null);
            start(async () => {
              const res = await sendInvitesAction(fd);
              if (!res.ok) setError(res.error);
            });
          }}
        >
          <div>
            <label className="label" htmlFor="emails">Email addresses *</label>
            <textarea id="emails" name="emails" required rows={3} className="input resize-y"
              placeholder="prae@kmids.ac.th, napat@kmids.ac.th&#10;mint@kmids.ac.th" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="invite-tier">Tier</label>
              <select id="invite-tier" name="tier" className="input" defaultValue="T1">
                {TIERS.map((t) => <option key={t} value={t}>{TIER_META[t].label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="invite-dept">Department</label>
              <select id="invite-dept" name="departmentId" className="input" defaultValue="">
                <option value="">None</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="invite-role">Role title</label>
              <input id="invite-role" name="roleTitle" maxLength={120} className="input" />
            </div>
          </div>

          <button type="submit" disabled={pending} className="btn-primary self-start">
            {pending ? 'Sending…' : 'Send invites'}
          </button>
        </form>

        {invites.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-2.5 text-[12.5px] font-bold text-muted-2">
              PENDING INVITES ({invites.length})
            </h3>
            <ul className="flex flex-col gap-1.5">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{i.email}</span>
                  <span className="mono-tag text-muted-2">{i.tier}</span>
                  <span className="text-[11.5px] text-muted-2">
                    {i.department_id ? deptNames[i.department_id] ?? '—' : 'No department'}
                  </span>
                  <button type="button" disabled={pending} aria-label={`Revoke invite for ${i.email}`}
                    onClick={() => run(() => revokeInviteAction(i.id))}
                    className="text-muted hover:text-danger">
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Invite keys (§4B) */}
      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-bold">
          <KeyRound size={16} className="text-pink" /> Invite keys
        </h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          A shareable code that grants a preset tier and department — useful for onboarding
          a whole department at once. Revoking a key does not remove accounts already created
          with it.
        </p>

        <form
          className="grid gap-3 sm:grid-cols-5"
          action={(fd) => {
            setError(null);
            start(async () => {
              const res = await createInviteKeyAction(fd);
              if (!res.ok) setError(res.error);
            });
          }}
        >
          <div className="sm:col-span-2">
            <label className="label" htmlFor="key-label">Label</label>
            <input id="key-label" name="label" maxLength={120} className="input"
              placeholder="Ops onboarding" />
          </div>
          <div>
            <label className="label" htmlFor="key-tier">Tier</label>
            <select id="key-tier" name="tier" className="input" defaultValue="T1">
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="key-dept">Department</label>
            <select id="key-dept" name="departmentId" className="input" defaultValue="">
              <option value="">None</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="key-uses">Max uses</label>
            <input id="key-uses" name="maxUses" type="number" min={1} max={200} defaultValue={10}
              className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="key-expires">Expires</label>
            <input id="key-expires" name="expiresAt" type="date" className="input" />
          </div>
          <div className="flex items-end sm:col-span-3">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? 'Creating…' : 'Create key'}
            </button>
          </div>
        </form>

        {keys.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <ul className="flex flex-col gap-2">
              {keys.map((k) => {
                const dead = Boolean(k.revoked_at) || k.uses >= k.max_uses;
                return (
                  <li key={k.id}
                    className="flex flex-wrap items-center gap-2.5 rounded-md bg-surface-2 px-3 py-2.5"
                    style={{ opacity: dead ? 0.5 : 1 }}>
                    <code className="font-mono text-[13px] font-bold text-deep">{k.code}</code>
                    <CopyButton value={k.code} />
                    {k.label ? <span className="text-[12.5px]">{k.label}</span> : null}
                    <span className="mono-tag text-muted-2">{k.tier}</span>
                    <span className="text-[11.5px] text-muted-2">
                      {k.department_id ? deptNames[k.department_id] ?? '—' : 'No department'}
                    </span>
                    <span className="text-[11.5px] text-muted-2">
                      {k.uses}/{k.max_uses} used
                    </span>
                    {k.expires_at ? (
                      <span className="text-[11.5px] text-muted-2">
                        expires {formatDate(k.expires_at)}
                      </span>
                    ) : null}
                    {k.revoked_at ? (
                      <span className="mono-tag text-danger">REVOKED</span>
                    ) : (
                      <button type="button" disabled={pending} className="ml-auto text-muted hover:text-danger"
                        aria-label={`Revoke key ${k.code}`}
                        onClick={() => run(() => revokeInviteKeyAction(k.id))}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${value}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="text-muted hover:text-ink"
    >
      <Copy size={12} />
      {copied ? <span className="ml-1 text-[11px] text-teal">copied</span> : null}
    </button>
  );
}
