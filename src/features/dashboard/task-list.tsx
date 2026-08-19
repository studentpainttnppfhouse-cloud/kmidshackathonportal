import Link from 'next/link';
import { ASSIGNMENT_STATUS_META } from '@/lib/types';
import { isOverdue, type AssignmentRow } from '@/lib/rows';
import { formatDue } from '@/lib/format';

export function TaskList({
  tasks,
  title,
  empty = 'Nothing due — enjoy it while it lasts.',
}: {
  tasks: AssignmentRow[];
  title: string;
  empty?: string;
}) {
  return (
    <section className="card p-5">
      <h2 className="mb-4 text-[14px] font-bold">{title}</h2>

      {tasks.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-2">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((t) => {
            const meta = ASSIGNMENT_STATUS_META[t.status];
            const over = isOverdue(t);
            return (
              <li key={t.id} className="border-b border-line last:border-0">
                <Link
                  href={`/assignments?task=${t.id}`}
                  className="flex items-center gap-3.5 py-3 text-ink hover:text-ink"
                >
                  <span
                    className="h-5 w-5 shrink-0 rounded-[6px] border-2"
                    style={{
                      borderColor: t.status === 'done' ? meta.color : 'var(--border-2)',
                      background: t.status === 'done' ? meta.color : 'transparent',
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{t.title}</span>
                    <span
                      className="block text-[12px] font-semibold"
                      style={{ color: over ? 'var(--danger)' : 'var(--muted-2)' }}
                    >
                      {formatDue(t.due_date, over)}
                    </span>
                  </span>
                  <span
                    className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                    style={{
                      color: meta.color,
                      background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
                    }}
                  >
                    {meta.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
