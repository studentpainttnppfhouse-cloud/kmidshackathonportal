'use client';

import { useMemo, useState } from 'react';
import { Search, Network, LayoutGrid } from 'lucide-react';
import { Avatar, colorFor } from '@/components/avatar';
import { TierBadge } from '@/components/tier-badge';
import type { Department } from '@/lib/types';
import type { DirectoryUser } from '@/lib/rows';

export function PeopleClient({
  people,
  departments,
}: {
  people: DirectoryUser[];
  departments: Department[];
}) {
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [view, setView] = useState<'grid' | 'org'>('grid');

  const deptById = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d])),
    [departments],
  );

  const filtered = people.filter((p) => {
    if (dept && p.department_id !== dept) return false;
    if (!query) return true;
    const hay = `${p.nickname ?? ''} ${p.name ?? ''} ${p.role_title ?? ''} ${p.email}`.toLowerCase();
    return hay.includes(query.toLowerCase());
  });

  return (
    <div className="mx-auto max-w-[1240px] animate-fadeup">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, nickname or role…"
            aria-label="Search people"
            className="input pl-9"
          />
        </div>

        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          aria-label="Filter by department"
          className="input w-auto min-w-[180px]"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <div className="inline-flex gap-1 rounded-[11px] border border-line bg-surface p-1">
          <button
            type="button"
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
              view === 'grid' ? 'bg-pink text-white' : 'text-muted-2'
            }`}
          >
            <LayoutGrid size={14} /> Directory
          </button>
          <button
            type="button"
            onClick={() => setView('org')}
            aria-pressed={view === 'org'}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
              view === 'org' ? 'bg-pink text-white' : 'text-muted-2'
            }`}
          >
            <Network size={14} /> Org chart
          </button>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => {
            const d = p.department_id ? deptById[p.department_id] : null;
            const color = d?.color ?? colorFor(p.email);
            return (
              <article key={p.id} className="card overflow-hidden p-5">
                <div className="-mx-5 -mt-5 mb-4 h-1" style={{ background: color }} />
                <div className="flex items-start gap-3">
                  <Avatar name={p.nickname ?? p.name ?? p.email} size={52} color={color} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">
                      {p.nickname ?? p.name ?? p.email}
                    </div>
                    <div className="text-[12.5px] text-muted-2">
                      {p.grade ?? '—'} · {p.role_title ?? 'Staff'}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <TierBadge tier={p.tier} />
                      {p.is_reserve ? <Flag label="Reserve" /> : null}
                      {p.is_mentor ? <Flag label="Mentor" /> : null}
                      {p.is_alumni ? <Flag label="Alumni" /> : null}
                    </div>
                  </div>
                </div>
                <div className="mt-3.5 border-t border-line pt-3 text-[12px] text-muted-2">
                  {d?.name ?? 'General'}
                </div>
              </article>
            );
          })}

          {filtered.length === 0 ? (
            <p className="col-span-full py-12 text-center text-[13px] text-muted-2">
              Nobody matches that search.
            </p>
          ) : null}
        </div>
      ) : (
        <OrgChart people={people} departments={departments} />
      )}
    </div>
  );
}

function Flag({ label }: { label: string }) {
  return (
    <span className="mono-tag rounded-[5px] border border-line-2 px-1.5 py-px text-muted-2">
      {label}
    </span>
  );
}

/** Six departments, each showing its head first and then its members. */
function OrgChart({
  people,
  departments,
}: {
  people: DirectoryUser[];
  departments: Department[];
}) {
  const leadership = people.filter((p) => p.tier === 'T4' || p.tier === 'T3');
  const advisors = people.filter((p) => p.tier === 'T0');

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5">
        <h2 className="mb-4 text-[13px] font-bold uppercase tracking-[0.04em] text-muted-2">
          Administration
        </h2>
        <div className="flex flex-wrap gap-3">
          {leadership.map((p) => (
            <PersonChip key={p.id} person={p} color="#7C3AED" />
          ))}
          {leadership.length === 0 ? (
            <p className="text-[13px] text-muted-2">No administrators yet.</p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {departments.map((d) => {
          const members = people.filter((p) => p.department_id === d.id);
          const head = members.find((m) => m.id === d.head_user_id) ?? members.find((m) => m.tier === 'T2');
          const rest = members.filter((m) => m.id !== head?.id);

          return (
            <section key={d.id} className="card overflow-hidden p-5">
              <div className="-mx-5 -mt-5 mb-4 h-1.5" style={{ background: d.color }} />
              <h3 className="text-[14px] font-bold">{d.name}</h3>
              <p className="mb-3.5 text-[12px] text-muted-2">
                {members.length} {members.length === 1 ? 'person' : 'people'}
              </p>

              {head ? (
                <div className="mb-3">
                  <div className="mono-tag mb-1.5 text-muted">HEAD</div>
                  <PersonChip person={head} color={d.color} />
                </div>
              ) : null}

              {rest.length > 0 ? (
                <>
                  <div className="mono-tag mb-1.5 text-muted">MEMBERS</div>
                  <div className="flex flex-wrap gap-2">
                    {rest.map((p) => (
                      <PersonChip key={p.id} person={p} color={d.color} compact />
                    ))}
                  </div>
                </>
              ) : null}

              {members.length === 0 ? (
                <p className="text-[12.5px] text-muted-2">Nobody assigned yet.</p>
              ) : null}
            </section>
          );
        })}
      </div>

      {advisors.length > 0 ? (
        <section className="card p-5">
          <h2 className="mb-4 text-[13px] font-bold uppercase tracking-[0.04em] text-muted-2">
            Advisors
          </h2>
          <div className="flex flex-wrap gap-3">
            {advisors.map((p) => (
              <PersonChip key={p.id} person={p} color="#64748B" />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PersonChip({
  person,
  color,
  compact = false,
}: {
  person: DirectoryUser;
  color: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
      <Avatar name={person.nickname ?? person.name ?? person.email} size={compact ? 24 : 30} color={color} />
      <div className="leading-tight">
        <div className="text-[12.5px] font-semibold">
          {person.nickname ?? person.name ?? person.email}
        </div>
        {!compact ? (
          <div className="text-[11px] text-muted-2">{person.role_title ?? 'Staff'}</div>
        ) : null}
      </div>
    </div>
  );
}
