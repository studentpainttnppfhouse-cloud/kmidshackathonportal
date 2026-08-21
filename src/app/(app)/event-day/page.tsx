import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { atLeast, canReadIncidents } from '@/lib/permissions';
import { EVENT_MODE_START, EVENT_END } from '@/lib/types';
import {
  EventClient, type CheckinRow, type IncidentRow, type QuickRef, type RunSheetItem,
} from '@/features/event/event-client';

export const dynamic = 'force-dynamic';

export default async function EventDayPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const db = await userClient(user.id);

  // Outside 19-21 March the screens still work — they are just showing a
  // future day. Nobody wants to discover on the morning that it does not open.
  const realToday = new Date().toISOString().slice(0, 10);
  const today =
    realToday >= EVENT_MODE_START && realToday <= EVENT_END ? realToday : '2027-03-20';

  const [runRes, refRes, checkRes, incidentRes, reserveRes] = await Promise.all([
    db
      .from('event_items')
      .select('id, day, start_time, end_time, title, location, notes')
      .is('deleted_at', null)
      .order('day')
      .order('start_time'),
    db
      .from('quick_reference')
      .select('id, category, label, value')
      .is('deleted_at', null)
      .order('sort_order'),
    db
      .from('checkins')
      .select('user_id, day, checked_in_at, checked_out_at, users:user_id ( nickname, name, email )')
      .eq('day', today),
    db
      .from('incidents')
      .select('id, occurred_at, severity, description, location, resolution, users:reported_by ( nickname, name )')
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .limit(100),
    db
      .from('users')
      .select('id, nickname, name, email')
      .eq('is_reserve', true)
      .eq('status', 'active')
      .is('deleted_at', null),
  ]);

  const checkins: CheckinRow[] = (
    (checkRes.data ?? []) as unknown as (Omit<CheckinRow, 'name'> & {
      users: { nickname: string | null; name: string | null; email: string } | null;
    })[]
  ).map((c) => ({
    user_id: c.user_id,
    day: c.day,
    checked_in_at: c.checked_in_at,
    checked_out_at: c.checked_out_at,
    name: c.users?.nickname ?? c.users?.name ?? c.users?.email ?? 'Staff',
  }));

  const incidents: IncidentRow[] = (
    (incidentRes.data ?? []) as unknown as (Omit<IncidentRow, 'reporter'> & {
      users: { nickname: string | null; name: string | null } | null;
    })[]
  ).map((i) => ({
    id: i.id,
    occurred_at: i.occurred_at,
    severity: i.severity,
    description: i.description,
    location: i.location,
    resolution: i.resolution,
    reporter: i.users?.nickname ?? i.users?.name ?? null,
  }));

  return (
    <EventClient
      runSheet={(runRes.data ?? []) as unknown as RunSheetItem[]}
      quickRef={(refRes.data ?? []) as unknown as QuickRef[]}
      checkins={checkins}
      incidents={incidents}
      reserves={((reserveRes.data ?? []) as { id: string; nickname: string | null; name: string | null; email: string }[]).map(
        (r) => ({ id: r.id, userId: r.id, name: r.nickname ?? r.name ?? r.email }),
      )}
      myCheckin={checkins.find((c) => c.user_id === user.id) ?? null}
      today={today}
      canSeeIncidents={canReadIncidents(user.effectiveTier)}
      canDeploy={atLeast(user.effectiveTier, 'T3') && !user.impersonating}
      currentUserId={user.id}
    />
  );
}
