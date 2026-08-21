'use client';

import type { Transport } from './provider';

/**
 * Moves Yjs updates between editors over the relay in
 * `/api/collab/[documentId]`, in place of a Supabase Realtime channel.
 *
 * There is no websocket in front of Aurora, so peers post their updates and
 * poll for everyone else's. Polling adapts to what the document is doing: fast
 * while people are typing, slow when the page is just sitting open, so an
 * abandoned tab costs a request every few seconds rather than four a second.
 *
 * Yjs updates are idempotent and order-independent, so a dropped or repeated
 * poll costs nothing — the next one repairs it.
 */

/** While editing, or waiting on the join handshake. */
const POLL_ACTIVE_MS = 250;
/** Once nothing has happened for a while. */
const POLL_IDLE_MS = 2000;
/** How long a document stays "active" after the last message either way. */
const ACTIVE_FOR_MS = 5000;
/**
 * A document left open in a background tab. Long enough that an abandoned tab
 * costs almost nothing, short enough that coming back to it feels immediate —
 * and the visibility listener below wakes it the moment the tab is focused
 * anyway, so this is only the ceiling on how stale a hidden tab can get.
 */
const POLL_HIDDEN_MS = 15000;
/**
 * How often to say "still here", so a peer who has stopped typing is not
 * mistaken for an empty room by a client that is joining.
 */
const HEARTBEAT_MS = 10000;
/**
 * How long to wait for a live peer's snapshot.
 *
 * Only reached when the relay named *someone else* the seeder, so it has to
 * cover one round trip through the relay — our post, their poll, their reply,
 * our poll — which is roughly 600ms at the active interval. Double that for
 * headroom and no more: this is also the delay before the editor gives up on
 * a seeder that has since closed its tab, and a reload lands in exactly that
 * case for as long as the previous session stays inside the presence window.
 */
const SYNC_GRACE_MS = 1200;
/** Give up on the join if the relay cannot be reached at all. */
const CONNECT_TIMEOUT_MS = 5000;

interface RelayMessage {
  id: number;
  sender: string;
  event: string;
  payload: Record<string, unknown>;
}

interface RelayResponse {
  messages: RelayMessage[];
  cursor: number;
  /** Which client the relay holds responsible for seeding the document. */
  seeder?: string | null;
}

/** Ignored by every peer; it exists only to be counted. */
const EVENT_PRESENCE = 'presence';

export function createHttpTransport(documentId: string, sender: string): Transport {
  const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
  const base = `/api/collab/${encodeURIComponent(documentId)}`;

  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let lastActivity = 0;
  let lastHeartbeat = 0;
  let seeder: string | null = null;
  // Posts are chained so updates reach the relay in the order they were made.
  let queue: Promise<unknown> = Promise.resolve();

  /** Post without marking the document active — see `send` for the real thing. */
  const post = (event: string, payload: Record<string, unknown>) => {
    queue = queue
      .then(() =>
        fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender, event, payload }),
          cache: 'no-store',
        }),
      )
      .catch(() => undefined);
  };

  const hidden = () =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const active = Date.now() - lastActivity < ACTIVE_FOR_MS;
    const delay = hidden() ? POLL_HIDDEN_MS : active ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    timer = setTimeout(poll, delay);
  };

  // Coming back to the tab should feel immediate rather than waiting out the
  // hidden interval, so poll at once and re-schedule at the visible cadence.
  const onVisibilityChange = () => {
    if (stopped || hidden()) return;
    void poll();
  };

  async function poll(): Promise<void> {
    if (stopped) return;
    try {
      const response = await fetch(
        `${base}?after=${cursor}&sender=${encodeURIComponent(sender)}`,
        { cache: 'no-store' },
      );
      if (response.ok) {
        const body = (await response.json()) as RelayResponse;
        cursor = body.cursor ?? cursor;
        seeder = body.seeder ?? null;
        if (body.messages.length > 0) lastActivity = Date.now();
        for (const message of body.messages) {
          handlers.get(message.event)?.(message.payload ?? {});
        }
      }

      if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
        lastHeartbeat = Date.now();
        post(EVENT_PRESENCE, {});
      }
    } catch {
      // A failed poll is not fatal: the next one picks up from the same
      // cursor, so nothing is lost by ignoring it.
    }
    schedule();
  }

  return {
    syncGraceMs: SYNC_GRACE_MS,

    on(event, handler) {
      handlers.set(event, handler);
    },

    isSeeder() {
      return seeder === null ? null : seeder === sender;
    },

    send(event, payload) {
      lastActivity = Date.now();
      lastHeartbeat = Date.now();
      post(event, payload);
    },

    async connect() {
      try {
        // Announce first, and wait for it to land: the read below asks the
        // relay who should seed the document, and the answer is only right if
        // this client is already among the candidates.
        await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender, event: EVENT_PRESENCE, payload: {} }),
          cache: 'no-store',
        });
        lastHeartbeat = Date.now();

        // One read both proves the relay is reachable and sets the cursor
        // past anything already in the table, so a joiner does not replay
        // another session's traffic.
        const response = await fetch(
          `${base}?after=0&sender=${encodeURIComponent(sender)}`,
          { cache: 'no-store', signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) },
        );
        if (!response.ok) return false;

        const body = (await response.json()) as RelayResponse;
        cursor = body.cursor ?? 0;
        seeder = body.seeder ?? null;
        lastActivity = Date.now();
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', onVisibilityChange);
        }
        schedule();
        return true;
      } catch {
        // Unreachable relay means solo editing, not a broken page.
        return false;
      }
    },

    disconnect() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    },
  };
}
