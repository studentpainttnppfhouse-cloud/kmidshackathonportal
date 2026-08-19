'use client';

import { useState, useTransition } from 'react';
import { LogOut, Monitor, ShieldCheck, Trash2 } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { TierBadge } from '@/components/tier-badge';
import { SHIRT_SIZES, type SessionUser } from '@/lib/types';
import { formatDateTime, relativeTime } from '@/lib/format';
import { signOutAction } from '@/app/signin/actions';
import { revokeDeviceAction, signOutEverywhereAction, updateProfileAction } from './actions';

export interface DeviceRow {
  id: string;
  device_label: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  isCurrent: boolean;
}

export function SettingsClient({
  user,
  departmentName,
  devices,
}: {
  user: SessionUser;
  departmentName: string;
  devices: DeviceRow[];
}) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mx-auto flex max-w-[720px] animate-fadeup flex-col gap-5">
      <section className="card p-5">
        <h2 className="mb-1 text-[14px] font-bold">Your profile</h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          This is everything we store about you. Nothing else.
        </p>

        <form
          className="flex flex-col gap-3.5"
          action={(fd) => {
            setError(null);
            setSaved(false);
            start(async () => {
              const res = await updateProfileAction(fd);
              if (res.ok) setSaved(true);
              else setError(res.error);
            });
          }}
        >
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="s-name">Full name *</label>
              <input id="s-name" name="name" required maxLength={120} className="input"
                defaultValue={user.name ?? ''} />
            </div>
            <div>
              <label className="label" htmlFor="s-nickname">Nickname *</label>
              <input id="s-nickname" name="nickname" required maxLength={60} className="input"
                defaultValue={user.nickname ?? ''} />
            </div>
            <div>
              <label className="label" htmlFor="s-grade">Grade</label>
              <input id="s-grade" name="grade" maxLength={30} className="input"
                defaultValue={user.grade ?? ''} />
            </div>
            <div>
              <label className="label" htmlFor="s-shirt">Shirt size</label>
              <select id="s-shirt" name="shirt_size" className="input" defaultValue={user.shirt_size ?? ''}>
                <option value="">Choose…</option>
                {SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="s-phone">Phone</label>
              <input id="s-phone" name="phone" type="tel" maxLength={40} className="input"
                defaultValue={user.phone ?? ''} />
            </div>
            <div>
              <label className="label" htmlFor="s-line">LINE ID</label>
              <input id="s-line" name="line_id" maxLength={60} className="input"
                defaultValue={user.line_id ?? ''} />
            </div>
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="rounded-md bg-surface-3 px-3 py-2 text-[12.5px] font-semibold text-deep">
              Saved.
            </p>
          ) : null}

          <button type="submit" disabled={pending} className="btn-primary self-start">
            {pending ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-3.5 text-[14px] font-bold">Your access</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px]">
          <dt className="text-muted-2">Email</dt>
          <dd className="font-semibold">{user.email}</dd>
          <dt className="text-muted-2">Tier</dt>
          <dd><TierBadge tier={user.tier} /></dd>
          <dt className="text-muted-2">Department</dt>
          <dd className="font-semibold">{departmentName}</dd>
          <dt className="text-muted-2">Role</dt>
          <dd className="font-semibold">{user.role_title ?? '—'}</dd>
        </dl>
        <p className="mt-3.5 text-[12px] text-muted-2">
          Only the event Owner can change your tier or department.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-[14px] font-bold">Appearance</h2>
        <p className="mb-3.5 text-[12.5px] text-muted-2">
          Light is the default. Your choice is remembered on this device.
        </p>
        <div className="flex items-center gap-3">
          <ThemeToggle compact />
          <span className="text-[13px] font-semibold">Dark theme</span>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-bold">
          <Monitor size={16} className="text-pink" /> Signed-in devices
        </h2>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Devices stay signed in so nobody is retyping anything on event morning.
          Sign out any you no longer use.
        </p>

        <ul className="flex flex-col">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">
                  {d.device_label ?? 'Unknown device'}
                  {d.isCurrent ? (
                    <span className="ml-2 rounded-full bg-surface-3 px-2 py-0.5 text-[10.5px] font-bold text-deep">
                      THIS DEVICE
                    </span>
                  ) : null}
                </div>
                <div className="text-[11.5px] text-muted-2">
                  Last used {relativeTime(d.last_seen_at)} · added {formatDateTime(d.created_at)}
                </div>
              </div>
              {!d.isCurrent ? (
                <button type="button" disabled={pending} aria-label="Sign out this device"
                  onClick={() => start(async () => {
                    const res = await revokeDeviceAction(d.id);
                    if (!res.ok) setError(res.error);
                  })}
                  className="text-muted hover:text-danger">
                  <Trash2 size={14} />
                </button>
              ) : null}
            </li>
          ))}
          {devices.length === 0 ? (
            <li className="py-3 text-[13px] text-muted-2">No other devices.</li>
          ) : null}
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-bold">
          <ShieldCheck size={16} className="text-pink" /> Session
        </h2>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button type="button" disabled={pending} className="btn-secondary"
            onClick={() => start(() => void signOutAction())}>
            <LogOut size={15} /> Sign out
          </button>
          <button type="button" disabled={pending} className="btn-secondary"
            onClick={() => {
              if (!confirm('Sign out on every device, including this one?')) return;
              start(async () => {
                await signOutEverywhereAction();
                await signOutAction();
              });
            }}>
            Sign out everywhere
          </button>
        </div>
      </section>
    </div>
  );
}
