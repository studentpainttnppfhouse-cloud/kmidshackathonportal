import { getSessionUser } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import {
  daysToEvent, getAnnouncements, getAssignments, getDepartments,
  isOverdue, summariseByDepartment,
} from '@/lib/db';
import { atLeast } from '@/lib/permissions';
import { adminClient } from '@/lib/supabase/admin';
import { relativeTime } from '@/lib/format';
import { CountdownHero } from '@/features/dashboard/countdown-hero';
import { TaskList } from '@/features/dashboard/task-list';
import {
  AnnouncementsPanel, DepartmentProgress, LiveActivity, OverduePanel,
  QuickActions, StatTile, type ActivityEntry,
} from '@/features/dashboard/panels';

export const dynamic = 'force-dynamic';

/**
 * The home screen changes shape by tier (§5.2):
 *   Member — my tasks, announcements, quick actions, countdown
 *   Head   — the above plus department progress, overdue by person, approvals
 *   Admin  — all six departments, overall completion, blocked items, activity
 */
export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const tier = user.effectiveTier;
  const mode = tier === 'T2' ? 'head' : atLeast(tier, 'T3') ? 'admin' : 'member';

  const [departments, allAssignments, announcements] = await Promise.all([
    getDepartments(user),
    getAssignments(user),
    getAnnouncements(user, 4),
  ]);

  const myTasks = allAssignments
    .filter((a) => a.assignees.some((x) => x.user_id === user.id))
    .filter((a) => a.status !== 'done')
    .slice(0, 8);

  const progress = summariseByDepartment(departments, allAssignments);
  const totalDone = progress.reduce((n, d) => n + d.done, 0);
  const totalAll = progress.reduce((n, d) => n + d.total, 0);
  const overallPct = totalAll === 0 ? 0 : Math.round((totalDone / totalAll) * 100);
  const overdueAll = allAssignments.filter(isOverdue);

  const caption =
    overdueAll.length === 0
      ? "You're on track. Keep the momentum going."
      : `${overdueAll.length} item${overdueAll.length === 1 ? '' : 's'} need attention.`;

  return (
    <div className="mx-auto flex max-w-[1180px] animate-fadeup flex-col gap-5">
      <CountdownHero days={daysToEvent()} pct={overallPct} caption={caption} />

      {mode === 'member' ? (
        <div className="grid items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
          <TaskList tasks={myTasks} title="My tasks due this week" />
          <div className="flex flex-col gap-5">
            <QuickActions />
            <AnnouncementsPanel items={announcements} />
          </div>
        </div>
      ) : null}

      {mode === 'head' ? <HeadDashboard user={user} /> : null}
      {mode === 'admin' ? (
        <AdminDashboard
          progress={progress}
          overallPct={overallPct}
          totalAll={totalAll}
          blocked={overdueAll.length}
          activity={await recentActivity(user.tier)}
          staffCount={await activeStaffCount()}
        />
      ) : null}

      {mode !== 'member' ? (
        <TaskList tasks={myTasks} title="My tasks this week" />
      ) : null}
    </div>
  );
}

async function HeadDashboard({ user }: { user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>> }) {
  const [departments, deptAssignments, announcements] = await Promise.all([
    getDepartments(user),
    getAssignments(user, { departmentId: user.department_id }),
    getAnnouncements(user, 3),
  ]);

  const dept = departments.find((d) => d.id === user.department_id);
  const summary = summariseByDepartment(departments, deptAssignments).find(
    (d) => d.id === user.department_id,
  );

  const overdue = deptAssignments.filter(isOverdue).map((a) => ({
    id: a.id,
    title: a.title,
    who: a.assignees[0]?.nickname ?? a.assignees[0]?.name ?? 'Unassigned',
    days: Math.abs(
      Math.round(
        (new Date(`${a.due_date}T00:00:00`).getTime() - Date.now()) / 86_400_000,
      ),
    ),
  }));

  const pendingApproval = deptAssignments.filter((a) => a.status === 'needs_review');
  const pct = summary?.pct ?? 0;
  const inReview = pendingApproval.length;

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-4 text-[14px] font-bold">
            {dept?.name ?? 'Your department'} — progress
          </h2>
          <div className="mb-4 flex items-center gap-4">
            <span className="text-[40px] font-extrabold tracking-[-0.02em] text-deep">
              {pct}%
            </span>
            <div className="flex-1">
              <div className="h-3 overflow-hidden rounded-[7px] bg-surface-3">
                <div
                  className="h-full"
                  style={{
                    width: `${pct}%`,
                    background: 'linear-gradient(90deg, var(--pink), var(--deep))',
                  }}
                />
              </div>
              <p className="mt-1.5 text-[12px] text-muted-2">
                {summary?.done ?? 0} of {summary?.total ?? 0} tasks done · {inReview} in review ·{' '}
                {overdue.length} overdue
              </p>
            </div>
          </div>
          <OverduePanel items={overdue} />
        </div>

        <section className="card p-5">
          <h2 className="mb-3.5 text-[14px] font-bold">Pending approvals</h2>
          {pendingApproval.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-2">Nothing waiting on you.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {pendingApproval.slice(0, 5).map((a) => (
                <div key={a.id} className="rounded-[11px] border border-line p-2.5">
                  <div className="text-[13px] font-semibold">{a.title}</div>
                  <div className="my-1 text-[11.5px] text-muted-2">
                    by {a.assignees[0]?.nickname ?? 'someone'} · {relativeTime(a.created_at)}
                  </div>
                  <a href={`/assignments?task=${a.id}`} className="btn-primary w-full py-1.5">
                    Review
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <AnnouncementsPanel items={announcements} />
    </>
  );
}

function AdminDashboard({
  progress, overallPct, totalAll, blocked, activity, staffCount,
}: {
  progress: Awaited<ReturnType<typeof summariseByDepartment>>;
  overallPct: number;
  totalAll: number;
  blocked: number;
  activity: ActivityEntry[];
  staffCount: number;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Overall completion" value={`${overallPct}%`} tone="deep" />
        <StatTile label="Tasks total" value={totalAll} />
        <StatTile label="Blocked" value={blocked} tone="danger" />
        <StatTile label="Active staff" value={staffCount} />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[1.7fr_1fr]">
        <DepartmentProgress items={progress} />
        <LiveActivity items={activity} />
      </div>
    </>
  );
}

/**
 * The activity feed reads the audit log, which is Owner-only by policy. For a
 * T3 admin we fall back to a redacted feed built from the same rows via the
 * admin client, showing what changed but not who changed it.
 */
async function recentActivity(realTier: string): Promise<ActivityEntry[]> {
  const { data } = await adminClient()
    .from('audit_log')
    .select('id, action, target_label, actor_email, created_at')
    .order('created_at', { ascending: false })
    .limit(8);

  const palette: Record<string, string> = {
    assignment: '#EC4899',
    document: '#BE185D',
    file: '#8E6C86',
    user: '#7C3AED',
    form: '#C05B86',
  };

  return (data ?? []).map((row) => {
    const [domain = 'app', verb = 'changed'] = row.action.split('.');
    return {
      id: row.id,
      actor: realTier === 'T4' ? (row.actor_email?.split('@')[0] ?? 'Someone') : 'Someone',
      action: verb.replace(/_/g, ' '),
      target: row.target_label ?? domain,
      when: relativeTime(row.created_at),
      color: palette[domain] ?? '#94A3B8',
    };
  });
}

async function activeStaffCount(): Promise<number> {
  const { count } = await adminClient()
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .is('deleted_at', null);
  return count ?? 0;
}
