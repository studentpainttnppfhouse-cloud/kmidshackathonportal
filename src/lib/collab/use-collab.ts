'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { CollabProvider, cursorColorFor } from './provider';
import { createSupabaseTransport } from './supabase-transport';

export type CollabStatus = 'connecting' | 'live' | 'solo';

export interface CollabPeer {
  clientId: number;
  name: string;
  color: string;
}

/**
 * Joins a document's collaboration channel.
 *
 * Returns `solo` when Realtime is unreachable — no project configured, a
 * blocked websocket, or the local dev shim. The editor stays fully usable in
 * that state and keeps its debounced autosave; it just cannot merge with
 * anyone else. That fallback is deliberate: an editor that refuses to open
 * because a websocket failed would be far worse than one that saves normally.
 */
export function useCollab(
  documentId: string,
  user: { name: string; email: string },
  enabled: boolean,
) {
  const [status, setStatus] = useState<CollabStatus>(enabled ? 'connecting' : 'solo');
  const [isFirst, setIsFirst] = useState<boolean | null>(enabled ? null : true);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const providerRef = useRef<CollabProvider | null>(null);
  const [provider, setProvider] = useState<CollabProvider | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('solo');
      setIsFirst(true);
      return undefined;
    }

    let cancelled = false;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      { auth: { persistSession: false } },
    );

    const instance = new CollabProvider(
      createSupabaseTransport(supabase, documentId),
      { name: user.name, color: cursorColorFor(user.email) },
    );
    providerRef.current = instance;
    setProvider(instance);

    const onAwareness = () => {
      const states = [...instance.awareness.getStates().entries()]
        .filter(([clientId]) => clientId !== instance.doc.clientID)
        .map(([clientId, state]) => {
          const u = (state as { user?: { name: string; color: string } }).user;
          return { clientId, name: u?.name ?? 'Someone', color: u?.color ?? '#94A3B8' };
        });
      setPeers(states);
    };
    instance.awareness.on('change', onAwareness);

    void instance.connect().then((result) => {
      if (cancelled) return;
      setStatus(result.connected ? 'live' : 'solo');
      setIsFirst(result.isFirst);
      onAwareness();
    });

    return () => {
      cancelled = true;
      instance.awareness.off('change', onAwareness);
      instance.destroy();
      providerRef.current = null;
    };
  }, [documentId, enabled, user.name, user.email]);

  return { status, isFirst, peers, provider };
}

/**
 * Whether collaboration should even be attempted.
 *
 * The local dev shim has no websocket server, so pointing at it would mean
 * every document waiting out the join timeout before falling back. Skipping
 * the attempt keeps local development snappy.
 */
export function collabAvailable(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!url) return false;
  return !/localhost|127\.0\.0\.1/.test(url);
}
