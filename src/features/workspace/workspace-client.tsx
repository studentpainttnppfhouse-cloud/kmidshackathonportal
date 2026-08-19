'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, Pin, FileText, Image as ImageIcon, Users, Megaphone, CheckSquare } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { TierBadge } from '@/components/tier-badge';
import { EcgDivider } from '@/components/ecg';
import { ASSIGNMENT_STATUS_META, type Department } from '@/lib/types';
import type { AnnouncementRow, AssignmentRow, DirectoryUser } from '@/lib/rows';
import { formatDate, formatDue } from '@/lib/format';
import { isOverdue } from '@/lib/rows';
import { TimeAgo } from '@/components/time-ago';
import { publishAnnouncementAction } from './announcement-actions';

type Tab = 'assignments' | 'documents' | 'files' | 'announcements' | 'members';

export interface WorkspaceDoc {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  owner: string | null;
}

export interface WorkspaceFile {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  created_at: string;
}

export function WorkspaceClient({
  departments,
  active,
  assignments,
  documents,
  files,
  announcements,
  members,
  canPost,
  canPostAll,
}: {
  departments: Department[];
  active: Department | null;
  assignments: AssignmentRow[];
  documents: WorkspaceDoc[];
  files: WorkspaceFile[];
  announcements: AnnouncementRow[];
  members: DirectoryUser[];
  canPost: boolean;
  canPostAll: boolean;
}) {
  const [tab, setTab] = useState<Tab>('assignments');

  const tabs: { key: Tab; label: string; icon: typeof Users; count: number }[] = [
    { key: 'assignments', label: 'Assignments', icon: CheckSquare, count: assignments.length },
    { key: 'documents', label: 'Documents', icon: FileText, count: documents.length },
    { key: 'files', label: 'Files', icon: ImageIcon, count: files.length },
    { key: 'announcements', label: 'Announcements', icon: Megaphone, count: announcements.length },
    { key: 'members', label: 'Members', icon: Users, count: members.length },
  ];

  return (
    <div className="mx-auto max-w-[1240px] animate-fadeup">
      {/* Space switcher — the six departments plus General */}
      <div className="mb-5 flex flex-wrap gap-2">
        <SpaceLink href="/workspace" label="General" color="#94A3B8" active={active === null} />
        {departments.map((d) => (
          <SpaceLink
            key={d.id}
            href={`/workspace?dept=${d.slug}`}
            label={d.name}
            color={d.color}
            active={active?.id === d.id}
          />
        ))}
      </div>

      <div className="mb-4">
        <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">
          {active?.name ?? 'General space'}
        </h2>
        <p className="text-[13px] text-muted-2">
          {active?.description ?? 'Shared with everyone on staff.'}
        </p>
        <EcgDivider className="mt-2" />
      </div>

      <div className="mb-5 flex gap-5 overflow-x-auto border-b border-line">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 py-3 text-[13.5px] transition-colors ${
              tab === key
                ? 'border-pink font-bold text-deep'
                : 'border-transparent font-medium text-muted-2 hover:text-ink'
            }`}
          >
            <Icon size={14} />
            {label}
            <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-muted-2">
              {count}
            </span>
          </button>
        ))}
      </div>

      {tab === 'assignments' ? <AssignmentsTab items={assignments} /> : null}
      {tab === 'documents' ? <DocumentsTab items={documents} /> : null}
      {tab === 'files' ? <FilesTab items={files} /> : null}
      {tab === 'announcements' ? (
        <AnnouncementsTab
          items={announcements}
          canPost={canPost}
          canPostAll={canPostAll}
          departmentId={active?.id ?? null}
        />
      ) : null}
      {tab === 'members' ? <MembersTab items={members} /> : null}
    </div>
  );
}

function SpaceLink({
  href, label, color, active,
}: { href: string; label: string; color: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px] font-semibold transition-colors ${
        active ? 'border-pink bg-surface-3 text-deep' : 'border-line bg-surface text-muted-2'
      }`}
    >
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </Link>
  );
}

function AssignmentsTab({ items }: { items: AssignmentRow[] }) {
  if (items.length === 0) return <Empty text="No assignments in this space yet." />;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((a) => {
        const meta = ASSIGNMENT_STATUS_META[a.status];
        const over = isOverdue(a);
        return (
          <li key={a.id}>
            <Link
              href={`/assignments?task=${a.id}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 text-ink shadow-card transition-colors hover:border-pink"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{a.title}</span>
                <span
                  className="text-[12px] font-semibold"
                  style={{ color: over ? 'var(--danger)' : 'var(--muted-2)' }}
                >
                  {formatDue(a.due_date, over)}
                </span>
              </span>
              <span
                className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}
              >
                {meta.label}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DocumentsTab({ items }: { items: WorkspaceDoc[] }) {
  if (items.length === 0) return <Empty text="No documents here yet." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((d) => (
        <Link key={d.id} href={`/documents/${d.id}`} className="card p-4 text-ink transition-colors hover:border-pink">
          <FileText size={18} className="mb-2 text-pink" />
          <div className="truncate text-[14px] font-semibold">{d.title}</div>
          <div className="mt-1 text-[12px] text-muted-2">
            {d.owner ?? 'Unknown'} · <TimeAgo iso={d.updated_at} />
          </div>
          <span className="mono-tag mt-2 inline-block rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-muted-2">
            {d.status.replace('_', ' ')}
          </span>
        </Link>
      ))}
    </div>
  );
}

function FilesTab({ items }: { items: WorkspaceFile[] }) {
  if (items.length === 0) return <Empty text="No files uploaded to this space." />;
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((f) => (
        <div key={f.id} className="card overflow-hidden">
          <div className="grid h-[110px] place-items-center bg-surface-3 text-deep">
            <ImageIcon size={26} />
          </div>
          <div className="p-3">
            <div className="truncate text-[13px] font-semibold">{f.name}</div>
            <div className="text-[11.5px] text-muted-2">{formatDate(f.created_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AnnouncementsTab({
  items, canPost, canPostAll, departmentId,
}: {
  items: AnnouncementRow[];
  canPost: boolean;
  canPostAll: boolean;
  departmentId: string | null;
}) {
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {canPost ? (
        composing ? (
          <form
            className="card flex flex-col gap-3 p-5"
            action={(fd) => {
              setError(null);
              start(async () => {
                const res = await publishAnnouncementAction(fd);
                if (res.ok) setComposing(false);
                else setError(res.error);
              });
            }}
          >
            <input type="hidden" name="department_id" value={departmentId ?? ''} />
            <div>
              <label className="label" htmlFor="ann-title">Title</label>
              <input id="ann-title" name="title" required maxLength={200} className="input" autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="ann-body">Message</label>
              <textarea id="ann-body" name="body" required rows={3} maxLength={4000} className="input resize-y" />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="label" htmlFor="ann-scope">Audience</label>
                <select id="ann-scope" name="scope" className="input w-auto" defaultValue="department">
                  <option value="department">This department</option>
                  {canPostAll ? <option value="all">All staff</option> : null}
                </select>
              </div>
              <label className="flex items-center gap-2 pb-2.5 text-[13px] font-semibold">
                <input type="checkbox" name="pinned" className="h-4 w-4 accent-pink" />
                <Pin size={13} /> Pin it
              </label>
            </div>
            {error ? (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="btn-primary">
                {pending ? 'Posting…' : 'Post announcement'}
              </button>
              <button type="button" onClick={() => setComposing(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setComposing(true)} className="btn-primary self-start">
            <Plus size={15} /> New announcement
          </button>
        )
      ) : null}

      {items.length === 0 ? (
        <Empty text="Nothing announced yet." />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.id} className="card p-4.5 p-5">
              <div className="mb-1.5 flex items-baseline gap-2">
                {a.pinned ? <Pin size={13} className="text-pink" /> : null}
                <span className="text-[14px] font-bold">{a.title}</span>
                <span className="ml-auto shrink-0 text-[11.5px] text-muted">
                  <TimeAgo iso={a.created_at} />
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] text-muted-2">{a.body}</p>
              <div className="mt-2.5 text-[12px] text-muted-2">
                {a.author?.nickname ?? a.author?.name ?? 'Staff'} ·{' '}
                {a.scope === 'all' ? 'All staff' : 'Department'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MembersTab({ items }: { items: DirectoryUser[] }) {
  if (items.length === 0) return <Empty text="Nobody assigned to this space yet." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((m) => (
        <div key={m.id} className="card flex items-center gap-3 p-4">
          <Avatar name={m.nickname ?? m.name ?? m.email} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">
              {m.nickname ?? m.name ?? m.email}
            </div>
            <div className="text-[12px] text-muted-2">{m.role_title ?? 'Staff'}</div>
          </div>
          <TierBadge tier={m.tier} />
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line py-12 text-center">
      <p className="text-[13px] text-muted-2">{text}</p>
    </div>
  );
}
