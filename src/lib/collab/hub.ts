import 'server-only';

/**
 * The in-process fan-out behind live document editing.
 *
 * Every editor holds an SSE stream open to `/api/collab/[documentId]`; every
 * keystroke it produces is POSTed to the same route and handed to the other
 * streams on that document. Yjs does the hard part — the payloads are opaque,
 * idempotent update bytes, so this only has to move them.
 *
 * It is deliberately in-process. The portal runs as a single web service, and
 * a school event does not need a message broker to let four people edit a
 * run-of-show together. The cost is that collaboration is scoped to one
 * instance: run two and editors on different instances fall back to editing
 * alone rather than merging. If the service is ever scaled out, this is the
 * one module to move onto a shared channel — nothing above it would change.
 *
 * Held on globalThis because Next reloads modules on every edit in
 * development, and a fresh registry per reload would silently disconnect
 * everyone who was already connected.
 */

export interface Message {
  event: string;
  payload: Record<string, unknown>;
}

interface Subscriber {
  id: string;
  documentId: string;
  deliver: (message: Message) => void;
}

const globalForHub = globalThis as unknown as {
  collabHub?: Map<string, Set<Subscriber>>;
};

function rooms(): Map<string, Set<Subscriber>> {
  if (!globalForHub.collabHub) globalForHub.collabHub = new Map();
  return globalForHub.collabHub;
}

export function subscribe(
  documentId: string,
  id: string,
  deliver: (message: Message) => void,
): () => void {
  const all = rooms();
  const room = all.get(documentId) ?? new Set<Subscriber>();
  const subscriber: Subscriber = { id, documentId, deliver };

  room.add(subscriber);
  all.set(documentId, room);

  return () => {
    room.delete(subscriber);
    // Do not leave an empty room behind for every document ever opened.
    if (room.size === 0) all.delete(documentId);
  };
}

/**
 * Hand a message to everyone on the document except its sender.
 *
 * A delivery that throws — a stream closed between the check and the write —
 * must not stop the others, so each one is isolated.
 */
export function publish(
  documentId: string,
  senderId: string,
  message: Message,
): number {
  const room = rooms().get(documentId);
  if (!room) return 0;

  let delivered = 0;
  for (const subscriber of room) {
    if (subscriber.id === senderId) continue;
    try {
      subscriber.deliver(message);
      delivered += 1;
    } catch {
      // The stream is gone; its own cleanup will unsubscribe it.
    }
  }
  return delivered;
}

/** How many editors are currently on a document. Used by the tests. */
export function peerCount(documentId: string): number {
  return rooms().get(documentId)?.size ?? 0;
}
