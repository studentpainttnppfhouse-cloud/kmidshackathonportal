'use client';

import { useEffect, useRef, useState } from 'react';
import { CollabProvider, cursorColorFor } from './provider';
import { createLiveTransport } from './live-transport';

export type CollabStatus = 'connecting' | 'live' | 'solo';

export interface CollabPeer {
  clientId: number;
  name: string;
  color: string;
}

/**
 * Joins a document's collaboration channel.
 *
 * Returns `solo` when the channel is unreachable. The editor stays fully
 * usable in that state and keeps its debounced autosave; it just cannot merge
 * with anyone else. That fallback is deliberate — an editor that refused to
 * open because a stream failed would be far worse than one that saves
 * normally.
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

    const instance = new CollabProvider(createLiveTransport(documentId), {
      name: user.name,
      color: cursorColorFor(user.email),
    });
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
