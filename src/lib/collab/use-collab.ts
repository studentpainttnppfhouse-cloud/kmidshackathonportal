'use client';

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { CollabProvider, cursorColorFor } from './provider';
import { createHttpTransport } from './http-transport';

export type CollabStatus = 'connecting' | 'live' | 'solo';

export interface CollabPeer {
  clientId: number;
  name: string;
  color: string;
}

/**
 * Joins a document's collaboration channel.
 *
 * Returns `solo` when the relay is unreachable. The editor stays fully usable
 * in that state and keeps its debounced autosave; it just cannot merge with
 * anyone else. That fallback is deliberate: an editor that refuses to open
 * because a request failed would be far worse than one that saves normally.
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

    // The Yjs client id doubles as the relay's sender id, so a peer can drop
    // its own messages without the server having to know who anyone is. The
    // document is made first so that id exists before the transport does.
    const doc = new Y.Doc();
    const transport = createHttpTransport(documentId, String(doc.clientID));
    const collab = new CollabProvider(
      transport,
      { name: user.name, color: cursorColorFor(user.email) },
      doc,
    );

    providerRef.current = collab;
    setProvider(collab);

    const onAwareness = () => {
      const states = [...collab.awareness.getStates().entries()]
        .filter(([clientId]) => clientId !== collab.doc.clientID)
        .map(([clientId, state]) => {
          const u = (state as { user?: { name: string; color: string } }).user;
          return { clientId, name: u?.name ?? 'Someone', color: u?.color ?? '#94A3B8' };
        });
      setPeers(states);
    };
    collab.awareness.on('change', onAwareness);

    void collab.connect().then((result) => {
      if (cancelled) return;
      setStatus(result.connected ? 'live' : 'solo');
      setIsFirst(result.isFirst);
      onAwareness();
    });

    return () => {
      cancelled = true;
      collab.awareness.off('change', onAwareness);
      collab.destroy();
      providerRef.current = null;
    };
  }, [documentId, enabled, user.name, user.email]);

  return { status, isFirst, peers, provider };
}
