"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  addPerson,
  type LinkState,
} from "@/lib/actions/people";
import { Feedback, SubmitButton } from "@/components/form-bits";
import { Avatar, TierPill } from "@/components/ui";
import { swatchStyle } from "@/lib/color";
import type { Tier } from "@prisma/client";

const TIER_RANK: Record<Tier, number> = { T0_ADVISOR: 0, T1_MEMBER: 1, T2_HEAD: 2, T3_ADMIN: 3, T4_OWNER: 4 };

const TIER_GROUP: Record<Tier, string> = {
  T4_OWNER: "Owners",
  T3_ADMIN: "Admins",
  T2_HEAD: "Department heads",
  T1_MEMBER: "Members",
  T0_ADVISOR: "Advisors",
};

export type PersonRow = {
  id: string;
  name: string;
  nickname: string | null;
  username: string | null;
  email: string | null;
  roleTitle: string | null;
  tier: Tier;
  avatarUrl: string | null;
  isActive: boolean;
  hasPassword: boolean | null;
  lastLoginAt: string | null;
  department: { name: string; color: string; slug: string; sortOrder: number } | null;
};

type Column = "role" | "department" | "tier" | "username" | "email" | "lastLogin" | "status";

const COLUMN_LABEL: Record<Column, string> = {
  role: "Role",
  department: "Department",
  tier: "Tier",
  username: "Username",
  email: "Email",
  lastLogin: "Last sign-in",
  status: "Status",
};

const ADMIN_COLUMNS: Column[] = ["username", "email", "lastLogin", "status"];
const DEFAULT_COLUMNS: Column[] = ["role", "department", "tier", "email", "status"];
const PREFS_KEY = "hs-people-prefs";

type Prefs = { groupBy: "tier" | "department" | "none"; sort: "rank" | "az" | "za"; columns: Column[] };

function readPrefs(): Prefs | null {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : null;
  } catch {
    return null;
  }
}

function writePrefs(prefs: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience.
  }
}

function shortDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Directory table
// ---------------------------------------------------------------------------

export function PeopleTable({ people, isAdmin }: { people: PersonRow[]; isAdmin: boolean }) {
  const available = (Object.keys(COLUMN_LABEL) as Column[]).filter(
    (c) => isAdmin || !ADMIN_COLUMNS.includes(c),
  );

  const [q, setQ] = useState("");
  const [groupBy, setGroupBy] = useState<Prefs["groupBy"]>("tier");
  const [sort, setSort] = useState<Prefs["sort"]>("rank");
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const prefs = readPrefs();
    if (prefs) {
      setGroupBy(prefs.groupBy);
      setSort(prefs.sort);
      setColumns(prefs.columns);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) writePrefs({ groupBy, sort, columns });
  }, [loaded, groupBy, sort, columns]);

  const shown = columns.filter((c) => available.includes(c));

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? people.filter((p) =>
          [p.name, p.nickname, p.username, p.email, p.roleTitle, p.department?.name]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(needle)),
        )
      : people;

    const label = (p: PersonRow) => (p.nickname || p.name).toLowerCase();
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "rank") {
        const byTier = TIER_RANK[b.tier] - TIER_RANK[a.tier];
        if (byTier !== 0) return byTier;
        return label(a).localeCompare(label(b));
      }
      const byName = label(a).localeCompare(label(b));
      return sort === "az" ? byName : -byName;
    });

    if (groupBy === "none") return [{ key: "all", title: "", people: sorted }];

    const map = new Map<string, { key: string; title: string; order: number; people: PersonRow[] }>();
    for (const p of sorted) {
      const key = groupBy === "tier" ? p.tier : (p.department?.slug ?? "~none");
      const title =
        groupBy === "tier" ? TIER_GROUP[p.tier] : (p.department?.name ?? "No department");
      const order =
        groupBy === "tier" ? -TIER_RANK[p.tier] : (p.department?.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (!map.has(key)) map.set(key, { key, title, order, people: [] });
      map.get(key)!.people.push(p);
    }
    return [...map.values()].sort((a, b) => a.order - b.order);
  }, [people, q, sort, groupBy]);

  const total = groups.reduce((n, g) => n + g.people.length, 0);

  function toggle(column: Column) {
    setColumns((current) =>
      current.includes(column) ? current.filter((c) => c !== column) : [...current, column],
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          aria-label="Search people"
          className="hs-input max-w-xs"
        />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          Group
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as Prefs["groupBy"])}
            className="hs-input w-auto py-1.5"
          >
            <option value="tier">By tier</option>
            <option value="department">By department</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Prefs["sort"])}
            className="hs-input w-auto py-1.5"
          >
            <option value="rank">Rank, then name</option>
            <option value="az">Name A–Z</option>
            <option value="za">Name Z–A</option>
          </select>
        </label>
        <details className="relative">
          <summary className="hs-btn hs-btn-ghost cursor-pointer list-none px-3 py-1.5 text-xs">
            Columns
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-48 space-y-1 rounded-xl border border-line bg-surface p-2 shadow-lg">
            {available.map((c) => (
              <label key={c} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-ink">
                <input type="checkbox" checked={shown.includes(c)} onChange={() => toggle(c)} />
                {COLUMN_LABEL[c]}
              </label>
            ))}
          </div>
        </details>
        <span className="ml-auto text-xs text-faint">{total} people</span>
      </div>

      {total === 0 ? (
        <p className="rounded-xl border border-line p-6 text-center text-sm text-muted">Nobody matches that.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                {shown.map((c) => (
                  <th key={c} className="px-3 py-2 font-semibold">
                    {COLUMN_LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                {g.title ? (
                  <tr className="border-t border-line bg-tint">
                    <th colSpan={shown.length + 1} className="px-3 py-1.5 text-xs font-bold text-brand-deep">
                      {g.title} <span className="font-normal text-faint">· {g.people.length}</span>
                    </th>
                  </tr>
                ) : null}
                {g.people.map((p) => (
                  <tr key={p.id} className="border-t border-line-soft hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <Link href={`/people/${p.id}`} className="flex items-center gap-2.5">
                        <Avatar name={p.name} nickname={p.nickname} url={p.avatarUrl} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink">{p.nickname || p.name}</span>
                          {p.nickname && p.nickname !== p.name ? (
                            <span className="block truncate text-xs text-faint">{p.name}</span>
                          ) : null}
                        </span>
                      </Link>
                    </td>
                    {shown.map((c) => (
                      <td key={c} className="px-3 py-2 text-muted">
                        {c === "role" ? (p.roleTitle ?? "—") : null}
                        {c === "department" ? (
                          p.department ? (
                            <span className="hs-pill" style={swatchStyle(p.department.color)}>
                              {p.department.name}
                            </span>
                          ) : (
                            "—"
                          )
                        ) : null}
                        {c === "tier" ? <TierPill tier={p.tier} /> : null}
                        {c === "username" ? (p.username ?? "—") : null}
                        {c === "email" ? <span className="break-all">{p.email ?? "—"}</span> : null}
                        {c === "lastLogin" ? shortDate(p.lastLoginAt) : null}
                        {c === "status" ? (
                          !p.isActive ? (
                            <span className="hs-pill bg-danger-soft text-danger-strong">Suspended</span>
                          ) : p.hasPassword === false ? (
                            <span className="hs-pill bg-warn-soft text-warn-strong">Not set up</span>
                          ) : (
                            <span className="hs-pill bg-ok-soft text-ok-strong">Active</span>
                          )
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add person
// ---------------------------------------------------------------------------

const ROLE_TIERS: { tier: Tier; label: string }[] = [
  { tier: "T1_MEMBER", label: "Member" },
  { tier: "T2_HEAD", label: "Department head" },
  { tier: "T3_ADMIN", label: "Admin" },
  { tier: "T4_OWNER", label: "Owner" },
  { tier: "T0_ADVISOR", label: "Advisor" },
];

export function AddPersonButton({
  departments,
  viewerTier,
  startOpen,
}: {
  departments: { id: string; name: string }[];
  viewerTier: Tier;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <button type="button" className="hs-btn hs-btn-primary" onClick={() => setOpen(true)}>
        <span aria-hidden="true">＋</span> Add person
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-label="Add person"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="h-full w-full max-w-md overflow-y-auto bg-surface p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="hs-h2">Add person</h2>
              <button type="button" className="hs-btn hs-btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <AddPersonForm
              key={formKey}
              departments={departments}
              viewerTier={viewerTier}
              onAnother={() => setFormKey((k) => k + 1)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function AddPersonForm({
  departments,
  viewerTier,
  onAnother,
}: {
  departments: { id: string; name: string }[];
  viewerTier: Tier;
  onAnother: () => void;
}) {
  const [state, action] = useActionState<LinkState, FormData>(addPerson, {});
  const [preview, setPreview] = useState<string | null>(null);

  if (state.ok) {
    return (
      <div className="space-y-3">
        <Feedback state={state} />
        <button type="button" className="hs-btn hs-btn-secondary" onClick={onAnother}>
          Add somebody else
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="hs-label" htmlFor="ap-name">Full name</label>
        <input id="ap-name" name="name" required maxLength={120} autoComplete="off" className="hs-input" />
      </div>
      <div>
        <label className="hs-label" htmlFor="ap-email">Email</label>
        <input id="ap-email" name="email" type="email" required autoComplete="off" spellCheck={false} className="hs-input" />
      </div>
      <div>
        <label className="hs-label" htmlFor="ap-username">
          Username <span className="text-faint">(optional)</span>
        </label>
        <input
          id="ap-username"
          name="username"
          pattern="[A-Za-z0-9._\-]{3,32}"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="hs-input"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="hs-label" htmlFor="ap-tier">Role</label>
          <select id="ap-tier" name="tier" defaultValue="T1_MEMBER" className="hs-input">
            {ROLE_TIERS.filter((r) => TIER_RANK[r.tier] <= TIER_RANK[viewerTier]).map((r) => (
              <option key={r.tier} value={r.tier}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="hs-label" htmlFor="ap-dept">Department</label>
          <select id="ap-dept" name="departmentId" defaultValue="" className="hs-input">
            <option value="">None yet</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="hs-label" htmlFor="ap-title">
          Role title <span className="text-faint">(optional)</span>
        </label>
        <input id="ap-title" name="roleTitle" maxLength={80} placeholder="e.g. Sponsorship lead" className="hs-input" />
      </div>
      <div>
        <label className="hs-label" htmlFor="ap-avatar">
          Profile picture <span className="text-faint">(optional, up to 2 MB)</span>
        </label>
        <div className="flex items-center gap-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : null}
          <input
            id="ap-avatar"
            name="avatar"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
          />
        </div>
      </div>

      <Feedback state={state} />
      <SubmitButton pendingLabel="Adding…">Add person</SubmitButton>
    </form>
  );
}
