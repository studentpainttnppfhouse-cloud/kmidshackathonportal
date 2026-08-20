'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Info, LogIn, LogOut, MapPin, Users, WifiOff,
} from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { EcgLine } from '@/components/ecg';
import { checkInAction, deployReserveAction, fileIncidentAction, resolveIncidentAction } from './actions';

const CACHE_KEY = 'hs-eventday-cache';

export interface RunSheetItem {
  id: string;
  day: string;
  start_time: string;
  end_time: string | null;
  title: string;
  location: string | null;
  notes: string | null;
}

export interface QuickRef {
  id: string;
  category: string;
  label: string;
  value: string;
}

export interface CheckinRow {
  user_id: string;
  day: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  name: string;
}

export interface IncidentRow {
  id: string;
  occurred_at: string;
  severity: string;
  description: string;
  location: string | null;
  resolution: string | null;
  reporter: string | null;
}

export interface ReserveRow {
  id: string;
  name: string;
  userId: string;
}

type Tab = 'runsheet' | 'checkin' | 'reference' | 'incidents';

const SEVERITY_COLOR: Record<string, string> = {
  low: '#94A3B8',
  medium: '#F59E0B',
  high: '#E11D66',
  critical: '#7F1D1D',
};

/**
 * Event-Day Mode (§5.12). Phone-first, large touch targets, minimal payload.
 *
 * The run sheet and quick reference are cached to localStorage on every render
 * so they still show if the network drops in the middle of the venue — which
 * is exactly when someone needs the WiFi password and the floor map.
 */
export function EventClient({
  runSheet,
  quickRef,
  checkins,
  incidents,
  reserves,
  myCheckin,
  today,
  canSeeIncidents,
  canDeploy,
  currentUserId,
}: {
  runSheet: RunSheetItem[];
  quickRef: QuickRef[];
  checkins: CheckinRow[];
  incidents: IncidentRow[];
  reserves: ReserveRow[];
  myCheckin: CheckinRow | null;
  today: string;
  canSeeIncidents: boolean;
  canDeploy: boolean;
  currentUserId: string;
}) {
  const [tab, setTab] = useState<Tab>('runsheet');
  const [offline, setOffline] = useState(false);
  const [cached, setCached] = useState<{ runSheet: RunSheetItem[]; quickRef: QuickRef[] } | null>(null);

  useEffect(() => {
    // Keep the last good copy on the device.
    if (runSheet.length > 0 || quickRef.length > 0) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ runSheet, quickRef }));
      } catch {
        /* a full localStorage is not worth failing over */
      }
    } else {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) setCached(JSON.parse(raw) as { runSheet: RunSheetItem[]; quickRef: QuickRef[] });
      } catch {
        /* ignore */
      }
    }
  }, [runSheet, quickRef]);

  useEffect(() => {
    function update() {
      setOffline(!navigator.onLine);
    }
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const sheet = runSheet.length > 0 ? runSheet : cached?.runSheet ?? [];
  const reference = quickRef.length > 0 ? quickRef : cached?.quickRef ?? [];

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'runsheet', label: 'Run sheet', icon: CalendarClock },
    { key: 'checkin', label: 'Check-in', icon: LogIn },
    { key: 'reference', label: 'Reference', icon: Info },
    ...(canSeeIncidents || true ? [{ key: 'incidents' as const, label: 'Incidents', icon: AlertTriangle }] : []),
  ];

  return (
    <div className="mx-auto max-w-[720px] pb-24">
      {offline ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-[12.5px] font-semibold text-muted-2">
          <WifiOff size={15} />
          Offline — showing the last copy saved on this device.
        </div>
      ) : null}

      {tab === 'runsheet' ? <RunSheet items={sheet} today={today} /> : null}
      {tab === 'checkin' ? (
        <CheckIn
          checkins={checkins}
          myCheckin={myCheckin}
          today={today}
          reserves={reserves}
          canDeploy={canDeploy}
          currentUserId={currentUserId}
        />
      ) : null}
      {tab === 'reference' ? <Reference items={reference} /> : null}
      {tab === 'incidents' ? (
        <Incidents incidents={incidents} canSee={canSeeIncidents} canResolve={canDeploy} />
      ) : null}

      {/* Bottom tab bar — thumb-reachable on a phone. */}
      <nav
        aria-label="Event day sections"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
            className="flex flex-1 flex-col items-center gap-0.5 border-0 bg-transparent py-3 text-[10.5px] font-bold"
            style={{ color: tab === key ? 'var(--deep)' : 'var(--muted)' }}>
            <Icon size={19} strokeWidth={tab === key ? 2.2 : 1.75} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function RunSheet({ items, today }: { items: RunSheetItem[]; today: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const days = [...new Set(items.map((i) => i.day))].sort();
  const activeDay = days.includes(today) ? today : days[0] ?? today;
  const dayItems = items.filter((i) => i.day === activeDay);

  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const currentIndex = dayItems.findIndex(
    (i) => i.start_time <= clock && (i.end_time === null || i.end_time > clock),
  );
  const nowItem = currentIndex >= 0 ? dayItems[currentIndex] : null;
  const nextItem = currentIndex >= 0 ? dayItems[currentIndex + 1] : dayItems.find((i) => i.start_time > clock);

  return (
    <div className="flex flex-col gap-4">
      {nowItem ? (
        <section className="rounded-2xl border border-line p-5 shadow-raised"
          style={{ background: 'linear-gradient(120deg, var(--surface) 0%, var(--wash) 100%)' }}>
          <div className="mono-tag flex items-center gap-2 text-deep">
            <span className="h-2 w-2 animate-ecgpulse rounded-full bg-teal" /> NOW
          </div>
          <h2 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-[-0.02em]">
            {nowItem.title}
          </h2>
          <p className="mt-1 text-[13.5px] text-muted-2">
            {nowItem.start_time.slice(0, 5)}–{nowItem.end_time?.slice(0, 5) ?? '…'}
            {nowItem.location ? ` · ${nowItem.location}` : ''}
          </p>
          <div className="mt-3 opacity-60">
            <EcgLine width={600} height={22} strokeWidth={2} animate />
          </div>
        </section>
      ) : (
        <section className="card p-5 text-center">
          <p className="text-[13.5px] text-muted-2">Nothing scheduled right now.</p>
        </section>
      )}

      {nextItem ? (
        <section className="card p-4">
          <div className="mono-tag text-muted">NEXT</div>
          <h3 className="mt-1 text-[16px] font-bold">{nextItem.title}</h3>
          <p className="text-[13px] text-muted-2">
            {nextItem.start_time.slice(0, 5)}
            {nextItem.location ? ` · ${nextItem.location}` : ''}
          </p>
        </section>
      ) : null}

      <section className="card p-4">
        <h3 className="mb-3 text-[13px] font-bold text-muted-2">
          FULL RUN SHEET — {new Date(`${activeDay}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h3>
        {dayItems.length === 0 ? (
          <p className="text-[13px] text-muted-2">No run sheet for this day yet.</p>
        ) : (
          <ol className="flex flex-col">
            {dayItems.map((item, i) => (
              <li key={item.id}
                className="flex gap-3 border-b border-line py-3 last:border-0"
                style={{ opacity: i === currentIndex ? 1 : 0.75 }}>
                <span className="w-[54px] shrink-0 font-mono text-[12.5px] font-bold text-deep">
                  {item.start_time.slice(0, 5)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">{item.title}</span>
                  {item.location ? (
                    <span className="flex items-center gap-1 text-[12px] text-muted-2">
                      <MapPin size={11} /> {item.location}
                    </span>
                  ) : null}
                </span>
                {i === currentIndex ? (
                  <span className="mono-tag shrink-0 self-start rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-deep">
                    NOW
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function CheckIn({
  checkins, myCheckin, today, reserves, canDeploy, currentUserId,
}: {
  checkins: CheckinRow[];
  myCheckin: CheckinRow | null;
  today: string;
  reserves: ReserveRow[];
  canDeploy: boolean;
  currentUserId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const isIn = Boolean(myCheckin?.checked_in_at) && !myCheckin?.checked_out_at;
  const onSite = checkins.filter((c) => c.checked_in_at && !c.checked_out_at);

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5 text-center">
        <div className="mono-tag text-muted-2">YOUR STATUS</div>
        <div className="my-3 text-[22px] font-extrabold tracking-[-0.02em]"
          style={{ color: isIn ? 'var(--teal)' : 'var(--muted-2)' }}>
          {isIn ? 'Checked in' : 'Not checked in'}
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const res = await checkInAction(today, isIn ? 'out' : 'in');
              if (!res.ok) setError(res.error);
            });
          }}
          className="btn-primary w-full py-4 text-[15px]"
          style={isIn ? { background: 'var(--muted-2)' } : undefined}
        >
          {isIn ? <><LogOut size={18} /> Check out</> : <><LogIn size={18} /> Check in</>}
        </button>

        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </section>

      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-[13px] font-bold">
          <Users size={15} className="text-pink" />
          On site now
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-bold text-deep">
            {onSite.length}
          </span>
        </h3>
        {onSite.length === 0 ? (
          <p className="text-[13px] text-muted-2">Nobody checked in yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {onSite.map((c) => (
              <li key={c.user_id} className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-1.5">
                <Avatar name={c.name} size={24} />
                <span className="text-[12.5px] font-semibold">{c.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canDeploy ? (
        <section className="card p-4">
          <h3 className="mb-1 text-[13px] font-bold">Reserve deployment</h3>
          <p className="mb-3 text-[12.5px] text-muted-2">
            Assign a reserve to a gap. {reserves.length} reserve
            {reserves.length === 1 ? '' : 's'} available.
          </p>
          <form
            className="flex flex-col gap-2.5"
            action={(fd) => {
              setError(null);
              start(async () => {
                const res = await deployReserveAction(fd);
                if (!res.ok) setError(res.error);
              });
            }}
          >
            <input type="hidden" name="day" value={today} />
            <select name="userId" required aria-label="Reserve staff member" className="input">
              <option value="">Choose a reserve…</option>
              {reserves.map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}
            </select>
            <input name="station" required maxLength={200} className="input"
              placeholder="Station — e.g. Registration desk" aria-label="Station" />
            <input name="note" maxLength={500} className="input" placeholder="Note (optional)"
              aria-label="Note" />
            <button type="submit" disabled={pending} className="btn-primary">
              Deploy reserve
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function Reference({ items }: { items: QuickRef[] }) {
  const categories = [...new Set(items.map((i) => i.category))];

  if (items.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[13px] text-muted-2">No quick reference saved yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {categories.map((category) => (
        <section key={category} className="card p-4">
          <h3 className="mb-2.5 text-[13px] font-bold text-muted-2">{category.toUpperCase()}</h3>
          <dl className="flex flex-col">
            {items
              .filter((i) => i.category === category)
              .map((i) => (
                <div key={i.id} className="flex items-baseline gap-3 border-b border-line py-2.5 last:border-0">
                  <dt className="w-[120px] shrink-0 text-[12.5px] text-muted-2">{i.label}</dt>
                  <dd className="min-w-0 flex-1 select-all break-words text-[14px] font-semibold">
                    {i.value}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function Incidents({
  incidents, canSee, canResolve,
}: { incidents: IncidentRow[]; canSee: boolean; canResolve: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4">
        <h3 className="mb-1 flex items-center gap-2 text-[13px] font-bold">
          <AlertTriangle size={15} className="text-pink" /> Report an incident
        </h3>
        <p className="mb-3 text-[12.5px] text-muted-2">
          Anyone on staff can file one. Only Administration can read the log.
        </p>

        {filed ? (
          <div className="flex items-center gap-2 rounded-md bg-surface-3 px-3 py-2.5 text-[13px] font-semibold text-deep">
            <CheckCircle2 size={15} /> Reported. Administration has it.
            <button type="button" onClick={() => setFiled(false)} className="ml-auto text-[12px] underline">
              File another
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-2.5"
            action={(fd) => {
              setError(null);
              start(async () => {
                const res = await fileIncidentAction(fd);
                if (res.ok) setFiled(true);
                else setError(res.error);
              });
            }}
          >
            <textarea name="description" required rows={3} maxLength={4000} className="input resize-y"
              placeholder="What happened?" aria-label="What happened" />
            <div className="grid grid-cols-2 gap-2.5">
              <select name="severity" className="input" defaultValue="low" aria-label="Severity">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <input name="location" maxLength={200} className="input" placeholder="Where?"
                aria-label="Location" />
            </div>
            {error ? (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={pending} className="btn-primary py-3">
              {pending ? 'Filing…' : 'File report'}
            </button>
          </form>
        )}
      </section>

      {canSee ? (
        <section className="card p-4">
          <h3 className="mb-3 text-[13px] font-bold text-muted-2">INCIDENT LOG</h3>
          {incidents.length === 0 ? (
            <p className="text-[13px] text-muted-2">Nothing reported. Long may it last.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {incidents.map((i) => (
                <li key={i.id} className="rounded-xl border border-line p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                      style={{
                        color: SEVERITY_COLOR[i.severity] ?? '#94A3B8',
                        background: `color-mix(in srgb, ${SEVERITY_COLOR[i.severity] ?? '#94A3B8'} 15%, transparent)`,
                      }}>
                      {i.severity}
                    </span>
                    <span className="text-[11.5px] text-muted-2">
                      {new Date(i.occurred_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      {i.location ? ` · ${i.location}` : ''}
                    </span>
                    {i.resolution ? (
                      <span className="ml-auto text-[11px] font-bold text-teal">RESOLVED</span>
                    ) : null}
                  </div>
                  <p className="text-[13px]">{i.description}</p>
                  <p className="mt-1 text-[11.5px] text-muted">Reported by {i.reporter ?? 'unknown'}</p>

                  {i.resolution ? (
                    <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-2 text-[12.5px]">
                      {i.resolution}
                    </p>
                  ) : canResolve ? (
                    <button type="button" disabled={pending} className="btn-quiet mt-2 py-1.5"
                      onClick={() => {
                        const text = window.prompt('How was it resolved?');
                        if (!text) return;
                        start(async () => {
                          const res = await resolveIncidentAction(i.id, text);
                          if (!res.ok) setError(res.error);
                        });
                      }}>
                      Mark resolved
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="px-1 text-[12.5px] text-muted-2">
          The incident log is visible to Administration only.
        </p>
      )}
    </div>
  );
}
