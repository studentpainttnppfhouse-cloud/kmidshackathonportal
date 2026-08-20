'use client';

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Transport } from './provider';

/**
 * Moves Yjs updates over a Supabase Realtime broadcast channel, one channel
 * per document.
 *
 * `self: false` keeps a client from receiving its own broadcasts, and
 * `ack: false` keeps latency down — Yjs updates are idempotent, so a dropped
 * message is repaired by the next sync rather than needing delivery
 * guarantees.
 */
const JOIN_TIMEOUT_MS = 4000;

export function createSupabaseTransport(
  supabase: SupabaseClient,
  documentId: string,
): Transport {
  let channel: RealtimeChannel | null = null;
  const handlers = new Map<string, (payload: Record<string, unknown>) => void>();

  return {
    on(event, handler) {
      handlers.set(event, handler);
    },

    send(event, payload) {
      channel?.send({ type: 'broadcast', event, payload });
    },

    connect() {
      return new Promise<boolean>((resolve) => {
        try {
          channel = supabase.channel(`doc:${documentId}`, {
            config: { broadcast: { self: false, ack: false } },
          });

          for (const [event, handler] of handlers) {
            channel.on('broadcast', { event }, ({ payload }) => {
              handler((payload ?? {}) as Record<string, unknown>);
            });
          }

          // If Realtime is not reachable — no project, a blocked websocket, or
          // the local dev shim — resolve false so the editor falls back to
          // single-user autosave instead of hanging on a spinner.
          const timer = setTimeout(() => resolve(false), JOIN_TIMEOUT_MS);

          channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              clearTimeout(timer);
              resolve(true);
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              clearTimeout(timer);
              resolve(false);
            }
          });
        } catch {
          resolve(false);
        }
      });
    },

    disconnect() {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    },
  };
}
