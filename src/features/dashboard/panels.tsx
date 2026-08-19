import Link from 'next/link';
import { Plus, Upload, Megaphone, FileText } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { relativeTime } from '@/lib/format';
import type { AnnouncementRow, DeptProgress } from '@/lib/rows';

export function QuickActions() {
  const actions = [
    { href: '/assignments?new=1', label: 'New task', icon: Plus },
    { href: '/documents?new=1', label: 'Document', icon: FileText },
    { href: '/files', label: 'Upload', icon: Upload },
    { href: '/workspace?tab=announcements', label: 'Announce', icon: Megaphone },
  ];

  return (
    <section className="card p-5">
      <h2 className="mb-3.5 text-[14px] font-bold">Quick actions</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {actions.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2 rounded-[11px] border border-line-2 bg-surface-2 p-2.5 text-[12.5px] font-semibold text-ink transition-colors hover:border-pink"
          >
            <Icon size={15} strokeWidth={2} />
            {label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function AnnouncementsPanel({ items }: { items: AnnouncementRow[] }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3.5 text-[14px] font-bold">Announcements</h2>
      {items.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-muted-2">Nothing posted yet.</p>
      ) : (
        <ul>
          {items.map((a) => (
            <li key={a.id} className="border-b border-line py-2.5 last:border-0">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-bold text-deep">
                  {a.author?.nickname ?? a.author?.name ?? 'Staff'}
                  {a.pinned ? ' · pinned' : ''}
                </span>
                <span className="shrink-0 text-[11px] text-muted">
                  {relativeTime(a.created_at)}
                </span>
              </div>
              <div className="text-[13px] font-semibold">{a.title}</div>
              <p className="text-[13px] text-muted-2">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DepartmentProgress({ items }: { items: DeptProgress[] }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 text-[14px] font-bold">All departments at a glance</h2>
      <div className="flex flex-col gap-3.5">
        {items.map((d) => (
          <div key={d.id} className="flex items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: d.color }}
            />
            <Link
              href={`/workspace?dept=${d.slug}`}
              className="w-[110px] shrink-0 truncate text-[13px] font-semibold text-ink md:w-[150px]"
            >
              {d.name}
            </Link>
            <div className="h-[9px] flex-1 overflow-hidden rounded-[6px] bg-surface-3">
              <div
                className="h-full rounded-[6px]"
                style={{ width: `${d.pct}%`, background: d.color }}
              />
            </div>
            <span className="w-[52px] shrink-0 text-right text-[12px] font-semibold text-muted-2">
              {d.done}/{d.total}
            </span>
            <span className="w-[40px] shrink-0 text-right text-[13px] font-bold">{d.pct}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export interface ActivityEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  when: string;
  color: string;
}

export function LiveActivity({ items }: { items: ActivityEntry[] }) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-[14px] font-bold">
        <span className="h-2 w-2 animate-ecgpulse rounded-full bg-teal" />
        Live activity
      </h2>
      {items.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-muted-2">Nothing yet today.</p>
      ) : (
        <ul>
          {items.map((a) => (
            <li key={a.id} className="flex gap-2.5 py-2">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: a.color }}
              />
              <div className="min-w-0 text-[12.5px] leading-[1.45]">
                <b>{a.actor}</b> {a.action}{' '}
                <b className="text-deep">{a.target}</b>
                <div className="mono-tag text-muted">{a.when}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'deep' | 'danger' | 'plain';
}) {
  const color =
    tone === 'deep' ? 'var(--deep)' : tone === 'danger' ? 'var(--danger)' : 'var(--text)';
  return (
    <div className="card p-4.5 px-[18px] py-[18px]">
      <div className="text-[12px] font-semibold text-muted-2">{label}</div>
      <div
        className="text-[32px] font-extrabold tracking-[-0.02em]"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

export function OverduePanel({
  items,
}: {
  items: { id: string; title: string; who: string; days: number }[];
}) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-[12.5px] font-bold text-muted-2">OVERDUE BY PERSON</h2>
      {items.length === 0 ? (
        <p className="py-3 text-[13px] text-muted-2">Nothing overdue. Genuinely good work.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((o) => (
            <Link
              key={o.id}
              href={`/assignments?task=${o.id}`}
              className="flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-ink"
              style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}
            >
              <Avatar name={o.who} size={26} color="var(--danger)" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{o.title}</span>
              <span className="shrink-0 text-[11.5px] font-bold" style={{ color: 'var(--danger)' }}>
                {o.days}d over
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
