'use client';

import type { Transport } from './provider';

/**
 * Moves Yjs updates over the portal's own collaboration endpoint.
 *
 * Incoming edits arrive on a Server-Sent Events stream; outgoing ones are
 * POSTed to the same route. Two connections rather than one socket, which
 * sounds worse and is not: SSE reconnects by itself, it survives proxies that
 * close idle upgrades, and it needs no server beyond the Next route handler
 * that is already there.
 *
 * `connect()` resolves false rather than throwing when the channel cannot be
 * reached, and the editor stays fully usable in that state with its ordinary
 * autosave. An editor that refused to open because a stream failed would be
 * far worse than one that cannot merge.
 */
const JOIN_TIMEOUT_MS = 4000;

export function createLiveTransport(documentId: string): Transport {
  // Identifies this tab, so the server does not echo a client's own edits back
  // at it. Crypto is available in every browser that can run the editor.
  const clientId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const base = `/api/collab/${encodeURIComponent(documentId)}`;
  const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
  let source: EventSource | null = null;
  let closed = false;

  return {
    on(event, handler) {
      handlers.set(event, handler);
    },

    send(event, payload) {
      if (closed) return;
      void fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: clientId, event, payload }),
        // The last edit before a tab closes still has to get out.
        keepalive: true,
      }).catch(() => {
        // A dropped update is repaired by the next sync — Yjs updates carry
        // their own history, so there is nothing useful to do with the error.
      });
    },

    connect() {
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (joined: boolean) => {
          if (settled) return;
          settled = true;
          resolve(joined);
        };

        try {
          source = new EventSource(`${base}?client=${encodeURIComponent(clientId)}`);
        } catch {
          settle(false);
          return;
        }

        // If the stream is not reachable — an older deploy, a proxy that
        // strips SSE — fall back to editing alone rather than hanging on a
        // spinner.
        const timer = setTimeout(() => settle(false), JOIN_TIMEOUT_MS);

        source.onmessage = (message) => {
          let parsed: { event?: string; payload?: Record<string, unknown> };
          try {
            parsed = JSON.parse(message.data);
          } catch {
            return;
          }

          if (parsed.event === 'ready') {
            clearTimeout(timer);
            settle(true);
            return;
          }

          if (!parsed.event) return;
          handlers.get(parsed.event)?.(parsed.payload ?? {});
        };

        source.onerror = () => {
          // Before joining, an error is fatal to this attempt. After joining,
          // EventSource reconnects on its own and the document keeps working,
          // so it is left alone.
          if (!settled) {
            clearTimeout(timer);
            settle(false);
          }
        };
      });
    },

    disconnect() {
      closed = true;
      source?.close();
      source = null;
    },
  };
}
