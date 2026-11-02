"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { Avatar } from "@/components/ui";
import type { PickerUser } from "@/components/assignment-form";

export type PickerTeam = { id: string; name: string; color?: string | null };

type Sort = "team" | "name" | "role";

/**
 * Choosing who owns a task, in the standard centred pop-up.
 *
 * People are grouped by team, each team has a "select all" box so a whole
 * department can be added in one click, and nothing changes on the form until
 * OK is pressed. Cancel throws the draft away.
 */
export function PeoplePicker({
  open,
  onClose,
  people,
  teams,
  selected,
  onConfirm,
  focusTeamId,
}: {
  open: boolean;
  onClose: () => void;
  people: PickerUser[];
  teams: PickerTeam[];
  selected: string[];
  onConfirm: (ids: string[]) => void;
  focusTeamId?: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose people"
      description="Filter by team, tick a whole team at once, then press OK."
      size="lg"
    >
      {open ? (
        <PickerBody
          people={people}
          teams={teams}
          initial={selected}
          focusTeamId={focusTeamId}
          onCancel={onClose}
          onConfirm={(ids) => {
            onConfirm(ids);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function PickerBody({
  people,
  teams,
  initial,
  focusTeamId,
  onCancel,
  onConfirm,
}: {
  people: PickerUser[];
  teams: PickerTeam[];
  initial: string[];
  focusTeamId?: string;
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(initial));
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("team");

  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);
  const label = (p: PickerUser) => p.nickname || p.name;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter((p) => {
      if (team === "none" ? p.departmentId : team !== "all" && p.departmentId !== team) return false;
      if (!needle) return true;
      return `${p.name} ${p.nickname ?? ""} ${p.roleTitle ?? ""}`.toLowerCase().includes(needle);
    });
  }, [people, query, team]);

  // Sections: by team when sorting by team, otherwise one flat sorted list.
  const sections = useMemo(() => {
    const byName = (a: PickerUser, b: PickerUser) => label(a).localeCompare(label(b));
    if (sort !== "team") {
      const list = [...shown].sort(
        sort === "role"
          ? (a, b) => (a.roleTitle ?? "~").localeCompare(b.roleTitle ?? "~") || byName(a, b)
          : byName,
      );
      return [{ key: "all", title: `${list.length} people`, people: list }];
    }
    const groups = new Map<string, PickerUser[]>();
    for (const p of shown) {
      const k = p.departmentId ?? "none";
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    const order = [...teams.map((t) => t.id), "none"];
    // The task's own team goes first, it is the likeliest pick.
    if (focusTeamId) order.sort((a, b) => (a === focusTeamId ? -1 : b === focusTeamId ? 1 : 0));
    return order
      .filter((k) => groups.has(k))
      .map((k) => ({
        key: k,
        title: k === "none" ? "No team" : (teamName.get(k) ?? "Other"),
        people: groups.get(k)!.sort(byName),
      }));
  }, [shown, sort, teams, teamName, focusTeamId]);

  const setMany = (ids: string[], on: boolean) =>
    setDraft((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const shownIds = shown.map((p) => p.id);
  const allShownOn = shownIds.length > 0 && shownIds.every((id) => draft.has(id));

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or role…"
        aria-label="Search people"
        className="hs-input"
        autoFocus
      />

      <div className="flex flex-wrap gap-2">
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          aria-label="Filter by team"
          className="hs-input w-auto flex-1 py-2 text-sm"
        >
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="none">No team</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort"
          className="hs-input w-auto flex-1 py-2 text-sm"
        >
          <option value="team">Group by team</option>
          <option value="name">Sort by name</option>
          <option value="role">Sort by role</option>
        </select>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2 font-semibold text-ink">
          <input
            type="checkbox"
            checked={allShownOn}
            disabled={shownIds.length === 0}
            onChange={(e) => setMany(shownIds, e.target.checked)}
          />
          Select all shown ({shownIds.length})
        </label>
        {draft.size > 0 ? (
          <button
            type="button"
            onClick={() => setDraft(new Set())}
            className="font-semibold text-brand-deep hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div className="max-h-[45dvh] space-y-3 overflow-y-auto rounded-[10px] border border-line p-2">
        {sections.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">Nobody matches.</p>
        ) : (
          sections.map((s) => {
            const ids = s.people.map((p) => p.id);
            const on = ids.filter((id) => draft.has(id)).length;
            return (
              <section key={s.key}>
                <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-2 rounded-md bg-tint px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-brand-deep">
                  <input
                    type="checkbox"
                    checked={on === ids.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < ids.length;
                    }}
                    onChange={(e) => setMany(ids, e.target.checked)}
                  />
                  <span className="flex-1">{s.title}</span>
                  <span className="font-normal normal-case text-faint">
                    {on}/{ids.length}
                  </span>
                </label>
                <ul className="mt-1">
                  {s.people.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-tint/60">
                        <input
                          type="checkbox"
                          checked={draft.has(p.id)}
                          onChange={(e) => setMany([p.id], e.target.checked)}
                        />
                        <Avatar name={p.name} nickname={p.nickname} url={p.avatarUrl} size={26} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{label(p)}</span>
                          <span className="block truncate text-[11px] text-faint">
                            {[p.roleTitle, p.departmentId ? teamName.get(p.departmentId) : "No team"]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-sm text-muted">
          {draft.size} {draft.size === 1 ? "person" : "people"} selected
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="hs-btn hs-btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm([...draft])} className="hs-btn hs-btn-primary">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
