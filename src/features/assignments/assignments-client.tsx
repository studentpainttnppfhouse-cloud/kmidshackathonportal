'use client';

import { useState } from 'react';
import { Plus, LayoutGrid, List, CalendarDays, User, Globe } from 'lucide-react';
import type { AssignmentRow } from '@/lib/rows';
import type { Department } from '@/lib/types';
import { Board } from './board';
import { ListView } from './list-view';
import { CalendarView } from './calendar-view';
import { TaskDrawer, type DrawerComment } from './task-drawer';
import { NewTaskDialog } from './new-task-dialog';
import { AllTeamsView } from './all-teams-view';

type View = 'all' | 'board' | 'list' | 'calendar' | 'mine';

export function AssignmentsClient({
  assignments,
  departments,
  people,
  currentUserId,
  canCreate,
  canApprove,
  canEdit,
  commentsByTask,
  initialTaskId,
  overdueCount,
  seesAllTeams = false,
}: {
  assignments: AssignmentRow[];
  departments: Department[];
  people: { id: string; label: string }[];
  currentUserId: string;
  canCreate: boolean;
  canApprove: boolean;
  canEdit: boolean;
  commentsByTask: Record<string, DrawerComment[]>;
  initialTaskId?: string;
  overdueCount: number;
  /** Owner / Admin: show every team, with a team filter and the All teams view. */
  seesAllTeams?: boolean;
}) {
  const [view, setView] = useState<View>(seesAllTeams ? 'all' : 'board');
  const [team, setTeam] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(initialTaskId ?? null);
  const [creating, setCreating] = useState(false);

  const deptNames = Object.fromEntries(departments.map((d) => [d.id, d.name]));
  const teamFiltered =
    team === 'all'
      ? assignments
      : assignments.filter((a) => (a.department_id ?? 'general') === team);
  const visible =
    view === 'mine'
      ? teamFiltered.filter((a) => a.assignees.some((x) => x.user_id === currentUserId))
      : teamFiltered;

  const open = openId ? assignments.find((a) => a.id === openId) ?? null : null;

  const tabs: { key: View; label: string; icon: typeof List }[] = [
    ...(seesAllTeams ? [{ key: 'all' as View, label: 'All teams', icon: Globe }] : []),
    { key: 'board', label: 'Board', icon: LayoutGrid },
    { key: 'list', label: 'List', icon: List },
    { key: 'calendar', label: 'Calendar', icon: CalendarDays },
    { key: 'mine', label: 'My Tasks', icon: User },
  ];

  return (
    <div className="mx-auto max-w-[1280px] animate-fadeup">
      <div className="mb-5 flex flex-wrap items-center gap-3.5">
        <div className="inline-flex gap-1 rounded-[11px] border border-line bg-surface p-1">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                view === key ? 'bg-pink text-white' : 'text-muted-2 hover:text-ink'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {seesAllTeams ? (
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            aria-label="Filter by team"
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold"
          >
            <option value="all">All teams ({assignments.length})</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({assignments.filter((a) => a.department_id === d.id).length})
              </option>
            ))}
            <option value="general">
              General ({assignments.filter((a) => !a.department_id).length})
            </option>
          </select>
        ) : null}

        <div className="flex-1" />

        {overdueCount > 0 ? (
          <span className="flex items-center gap-2 text-[12.5px] text-muted-2">
            <span className="h-2 w-2 rounded-sm bg-danger" />
            {overdueCount} overdue
          </span>
        ) : null}

        {canCreate ? (
          <button type="button" onClick={() => setCreating(true)} className="btn-primary">
            <Plus size={15} /> New task
          </button>
        ) : null}
      </div>

      {view === 'all' ? (
        <AllTeamsView
          assignments={visible}
          deptNames={deptNames}
          deptOrder={departments.map((d) => d.id)}
          onOpen={setOpenId}
        />
      ) : null}
      {view === 'board' || view === 'mine' ? (
        <Board
          assignments={visible}
          deptNames={deptNames}
          canApproveHere={canApprove}
          onOpen={setOpenId}
        />
      ) : null}
      {view === 'list' ? (
        <ListView assignments={visible} deptNames={deptNames} onOpen={setOpenId} />
      ) : null}
      {view === 'calendar' ? (
        <CalendarView assignments={visible} onOpen={setOpenId} />
      ) : null}

      {open ? (
        <TaskDrawer
          task={open}
          comments={commentsByTask[open.id] ?? []}
          deptName={open.department_id ? deptNames[open.department_id] ?? 'General' : 'General'}
          canApprove={canApprove}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {creating ? (
        <NewTaskDialog
          departments={departments}
          people={people}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}
