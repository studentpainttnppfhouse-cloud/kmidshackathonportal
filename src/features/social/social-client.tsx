'use client';

import { useState, useTransition } from 'react';
import { AtSign, ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import {
  CONTENT_STATUSES, CONTENT_STATUS_META, type ContentStatus, type Department,
} from '@/lib/types';
import { deleteContentItemAction, saveContentItemAction, saveSocialAccountAction } from './actions';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'YouTube', 'X', 'LINE'];

export interface ContentItem {
  id: string;
  scheduled_date: string;
  platform: string;
  format: string | null;
  caption: string | null;
  script: string | null;
  status: ContentStatus;
  designer_id: string | null;
  editor_id: string | null;
  poster_id: string | null;
  department_id: string | null;
}

export interface SocialAccount {
  id: string;
  platform: string;
  handle: string;
  url: string | null;
  access_holder_user_id: string | null;
  notes: string | null;
}

export function SocialClient({
  items,
  accounts,
  people,
  departments,
  canEdit,
  defaultDepartmentId,
}: {
  items: ContentItem[];
  accounts: SocialAccount[];
  people: { id: string; label: string }[];
  departments: Department[];
  canEdit: boolean;
  defaultDepartmentId: string | null;
}) {
  const [cursor, setCursor] = useState(new Date(2027, 2, 1));
  const [editing, setEditing] = useState<ContentItem | 'new' | null>(null);
  const [editingAccount, setEditingAccount] = useState<SocialAccount | 'new' | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay = new Map<string, ContentItem[]>();
  for (const item of items) {
    byDay.set(item.scheduled_date, [...(byDay.get(item.scheduled_date) ?? []), item]);
  }

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const peopleById = Object.fromEntries(people.map((p) => [p.id, p.label]));

  return (
    <div className="mx-auto max-w-[1280px] animate-fadeup">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-[18px] font-extrabold tracking-[-0.02em]">
          {cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </h2>
        <button type="button" aria-label="Previous month"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface">
          <ChevronLeft size={16} />
        </button>
        <button type="button" aria-label="Next month"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface">
          <ChevronRight size={16} />
        </button>

        <div className="flex-1" />

        <div className="flex flex-wrap gap-2">
          {CONTENT_STATUSES.map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-2">
              <span className="h-2 w-2 rounded-sm" style={{ background: CONTENT_STATUS_META[s].color }} />
              {CONTENT_STATUS_META[s].label}
            </span>
          ))}
        </div>

        {canEdit ? (
          <button type="button" onClick={() => setEditing('new')} className="btn-primary">
            <Plus size={15} /> New post
          </button>
        ) : null}
      </div>

      <div className="mb-6 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="grid grid-cols-7 text-[11px] font-bold text-muted-2">
          {WEEKDAYS.map((d) => <div key={d} className="p-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border-l border-t border-line">
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`b-${i}`} className="min-h-[94px] border-b border-r border-line" />;
            }
            const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayItems = byDay.get(iso) ?? [];
            const isEventDay = iso === '2027-03-20' || iso === '2027-03-21';

            return (
              <div key={iso} className="min-h-[94px] border-b border-r border-line p-1.5"
                style={{ background: isEventDay ? 'var(--surface-3)' : 'var(--surface)' }}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-semibold">{day}</span>
                  {canEdit ? (
                    <button type="button" aria-label={`Add a post on ${iso}`}
                      onClick={() => setEditing({
                        id: '', scheduled_date: iso, platform: 'Instagram', format: null,
                        caption: null, script: null, status: 'idea', designer_id: null,
                        editor_id: null, poster_id: null, department_id: defaultDepartmentId,
                      })}
                      className="text-muted opacity-0 transition-opacity hover:text-pink focus:opacity-100 group-hover:opacity-100">
                      <Plus size={12} />
                    </button>
                  ) : null}
                </div>
                {dayItems.map((item) => {
                  const meta = CONTENT_STATUS_META[item.status];
                  return (
                    <button key={item.id} type="button" onClick={() => setEditing(item)}
                      className="mt-1 block w-full rounded-[6px] px-1.5 py-1 text-left"
                      style={{
                        background: `color-mix(in srgb, ${meta.color} 16%, transparent)`,
                        borderLeft: `3px solid ${meta.color}`,
                      }}>
                      <span className="mono-tag block" style={{ color: meta.color }}>
                        {item.platform.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="block truncate text-[10px] font-semibold">
                        {item.caption || item.format || meta.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <section className="card p-5">
        <div className="mb-1 flex items-center gap-2">
          <AtSign size={16} className="text-pink" />
          <h2 className="text-[14px] font-bold">Accounts</h2>
          {canEdit ? (
            <button type="button" onClick={() => setEditingAccount('new')}
              className="btn-quiet ml-auto py-1.5">
              <Plus size={13} /> Add account
            </button>
          ) : null}
        </div>
        <p className="mb-4 text-[12.5px] text-muted-2">
          Who holds access to each platform. Passwords are never stored here — only the
          name of the person who has them.
        </p>

        {accounts.length === 0 ? (
          <p className="py-3 text-[13px] text-muted-2">No accounts recorded yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <button key={a.id} type="button" onClick={() => canEdit && setEditingAccount(a)}
                className="rounded-xl border border-line bg-surface-2 p-3.5 text-left transition-colors hover:border-pink">
                <div className="text-[13.5px] font-bold">{a.platform}</div>
                <div className="text-[12.5px] text-muted-2">{a.handle}</div>
                <div className="mt-2.5 flex items-center gap-2">
                  {a.access_holder_user_id ? (
                    <>
                      <Avatar name={peopleById[a.access_holder_user_id] ?? '?'} size={24} />
                      <span className="truncate text-[11.5px] text-muted-2">
                        {peopleById[a.access_holder_user_id] ?? 'Unknown'}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11.5px] text-danger">No access holder set</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {editing ? (
        <ContentDialog
          item={editing === 'new'
            ? {
                id: '', scheduled_date: new Date().toISOString().slice(0, 10),
                platform: 'Instagram', format: null, caption: null, script: null,
                status: 'idea', designer_id: null, editor_id: null, poster_id: null,
                department_id: defaultDepartmentId,
              }
            : editing}
          people={people}
          departments={departments}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {editingAccount ? (
        <AccountDialog
          account={editingAccount === 'new'
            ? { id: '', platform: '', handle: '', url: null, access_holder_user_id: null, notes: null }
            : editingAccount}
          people={people}
          onClose={() => setEditingAccount(null)}
        />
      ) : null}
    </div>
  );
}

function ContentDialog({
  item, people, departments, canEdit, onClose,
}: {
  item: ContentItem;
  people: { id: string; label: string }[];
  departments: Department[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]" />
      <div role="dialog" aria-modal="true" aria-label="Content item"
        className="fixed left-1/2 top-1/2 z-[51] max-h-[88vh] w-[560px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-line bg-surface p-6 shadow-raised">
        <div className="mb-4 flex items-center">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">
            {item.id ? 'Edit post' : 'New post'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <form
          className="flex flex-col gap-3.5"
          action={(fd) => {
            setError(null);
            start(async () => {
              const res = await saveContentItemAction(item.id || null, fd);
              if (res.ok) onClose();
              else setError(res.error);
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="c-date">Date *</label>
              <input id="c-date" name="scheduled_date" type="date" required className="input"
                defaultValue={item.scheduled_date} disabled={!canEdit} />
            </div>
            <div>
              <label className="label" htmlFor="c-platform">Platform *</label>
              <select id="c-platform" name="platform" className="input"
                defaultValue={item.platform} disabled={!canEdit}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="c-format">Format</label>
              <input id="c-format" name="format" className="input" placeholder="Reel, carousel…"
                defaultValue={item.format ?? ''} disabled={!canEdit} />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="c-status">Status</label>
            <select id="c-status" name="status" className="input" defaultValue={item.status} disabled={!canEdit}>
              {CONTENT_STATUSES.map((s) => (
                <option key={s} value={s}>{CONTENT_STATUS_META[s].label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="c-caption">Caption</label>
            <textarea id="c-caption" name="caption" rows={2} className="input resize-y"
              defaultValue={item.caption ?? ''} disabled={!canEdit} />
          </div>

          <div>
            <label className="label" htmlFor="c-script">Script</label>
            <textarea id="c-script" name="script" rows={3} className="input resize-y"
              defaultValue={item.script ?? ''} disabled={!canEdit} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ['designer_id', 'Designer', item.designer_id],
              ['editor_id', 'Editor', item.editor_id],
              ['poster_id', 'Poster', item.poster_id],
            ] as const).map(([name, label, value]) => (
              <div key={name}>
                <label className="label" htmlFor={`c-${name}`}>{label}</label>
                <select id={`c-${name}`} name={name} className="input"
                  defaultValue={value ?? ''} disabled={!canEdit}>
                  <option value="">Unassigned</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div>
            <label className="label" htmlFor="c-dept">Department</label>
            <select id="c-dept" name="department_id" className="input"
              defaultValue={item.department_id ?? ''} disabled={!canEdit}>
              <option value="">General</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          ) : null}

          {canEdit ? (
            <div className="flex gap-2.5">
              <button type="submit" disabled={pending} className="btn-primary flex-1">
                {pending ? 'Saving…' : 'Save'}
              </button>
              {item.id ? (
                <button type="button" disabled={pending} className="btn-secondary"
                  onClick={() => {
                    if (!confirm('Delete this post?')) return;
                    start(async () => {
                      const res = await deleteContentItemAction(item.id);
                      if (res.ok) onClose();
                      else setError(res.error);
                    });
                  }}>
                  <Trash2 size={14} />
                </button>
              ) : null}
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            </div>
          ) : null}
        </form>
      </div>
    </>
  );
}

function AccountDialog({
  account, people, onClose,
}: {
  account: SocialAccount;
  people: { id: string; label: string }[];
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]" />
      <div role="dialog" aria-modal="true" aria-label="Social account"
        className="fixed left-1/2 top-1/2 z-[51] w-[440px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 shadow-raised">
        <div className="mb-4 flex items-center">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">
            {account.id ? 'Edit account' : 'Add account'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <form
          className="flex flex-col gap-3.5"
          action={(fd) => {
            setError(null);
            start(async () => {
              const res = await saveSocialAccountAction(fd);
              if (res.ok) onClose();
              else setError(res.error);
            });
          }}
        >
          {account.id ? <input type="hidden" name="id" value={account.id} /> : null}

          <div>
            <label className="label" htmlFor="a-platform">Platform *</label>
            <input id="a-platform" name="platform" required className="input"
              defaultValue={account.platform} placeholder="Instagram" />
          </div>
          <div>
            <label className="label" htmlFor="a-handle">Handle *</label>
            <input id="a-handle" name="handle" required className="input"
              defaultValue={account.handle} placeholder="@kmidshackathon" />
          </div>
          <div>
            <label className="label" htmlFor="a-url">URL</label>
            <input id="a-url" name="url" type="url" className="input" defaultValue={account.url ?? ''} />
          </div>
          <div>
            <label className="label" htmlFor="a-holder">Who holds access</label>
            <select id="a-holder" name="access_holder_user_id" className="input"
              defaultValue={account.access_holder_user_id ?? ''}>
              <option value="">Nobody assigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <p className="mt-1 text-[11.5px] text-muted">
              Never record a password here.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="a-notes">Notes</label>
            <textarea id="a-notes" name="notes" rows={2} className="input resize-y"
              defaultValue={account.notes ?? ''} />
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2.5">
            <button type="submit" disabled={pending} className="btn-primary flex-1">
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
