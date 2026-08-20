import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';

/**
 * Collaborative editing over a broadcast channel.
 *
 * Yjs gives conflict-free merging; all this provider has to do is move opaque
 * update bytes between peers and keep awareness (cursors, names) in sync.
 *
 * The transport is injected rather than hard-wired to Supabase so the merge
 * and hand-off logic can be tested without a network — see
 * tests/collab.test.ts, which runs two providers against an in-memory channel
 * and asserts they converge.
 */

export interface Transport {
  /** Send a message to every other peer on this document. */
  send(event: string, payload: Record<string, unknown>): void;
  /** Register a handler for messages from other peers. */
  on(event: string, handler: (payload: Record<string, unknown>) => void): void;
  /** Resolves true once joined. False means collaboration is unavailable. */
  connect(): Promise<boolean>;
  disconnect(): void;
}

export interface CollabUser {
  name: string;
  color: string;
}

const EVENT_UPDATE = 'yjs-update';
const EVENT_SYNC_REQUEST = 'yjs-sync-request';
const EVENT_SYNC_REPLY = 'yjs-sync-reply';
const EVENT_AWARENESS = 'awareness';

/** How long a joiner waits for a peer before assuming it is the first one in. */
export const SYNC_GRACE_MS = 600;

export class CollabProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  private readonly transport: Transport;
  private readonly user: CollabUser;
  private connected = false;
  private destroyed = false;
  private syncResolve: ((first: boolean) => void) | null = null;
  private sawPeer = false;

  constructor(transport: Transport, user: CollabUser, doc = new Y.Doc()) {
    this.transport = transport;
    this.user = user;
    this.doc = doc;
    this.awareness = new Awareness(this.doc);

    this.awareness.setLocalStateField('user', user);

    this.doc.on('update', this.onLocalUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);

    transport.on(EVENT_UPDATE, this.onRemoteUpdate);
    transport.on(EVENT_SYNC_REQUEST, this.onSyncRequest);
    transport.on(EVENT_SYNC_REPLY, this.onSyncReply);
    transport.on(EVENT_AWARENESS, this.onRemoteAwareness);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Join the document.
   *
   * Resolves `true` when this client is the first one in and therefore
   * responsible for seeding the document from the database, and `false` when a
   * peer supplied the state — which prevents two clients both inserting the
   * stored content and doubling it.
   */
  async connect(): Promise<{ connected: boolean; isFirst: boolean }> {
    this.connected = await this.transport.connect();
    if (!this.connected) return { connected: false, isFirst: true };

    const first = await new Promise<boolean>((resolve) => {
      this.syncResolve = resolve;
      this.transport.send(EVENT_SYNC_REQUEST, {});
      setTimeout(() => {
        if (this.syncResolve) {
          this.syncResolve(!this.sawPeer);
          this.syncResolve = null;
        }
      }, SYNC_GRACE_MS);
    });

    return { connected: true, isFirst: first };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off('update', this.onLocalUpdate);

    // Announce departure while the awareness handler is still attached.
    // Detaching first would swallow the removal and leave a ghost cursor on
    // every other screen until they happened to reload.
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');

    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.destroy();
    this.transport.disconnect();
  }

  // -- outgoing -------------------------------------------------------------

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // Updates that arrived from a peer must not be echoed back.
    if (origin === this || !this.connected) return;
    this.transport.send(EVENT_UPDATE, { update: toBase64(update) });
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || !this.connected) return;
    const changed = [...added, ...updated, ...removed];
    this.transport.send(EVENT_AWARENESS, {
      update: toBase64(encodeAwarenessUpdate(this.awareness, changed)),
    });
  };

  // -- incoming -------------------------------------------------------------

  private onRemoteUpdate = (payload: Record<string, unknown>) => {
    const update = fromBase64(payload.update);
    if (!update) return;
    Y.applyUpdate(this.doc, update, this);
  };

  private onSyncRequest = () => {
    // Someone just joined. Hand them everything we have.
    this.transport.send(EVENT_SYNC_REPLY, {
      update: toBase64(Y.encodeStateAsUpdate(this.doc)),
    });
    if (this.awareness.getStates().size > 0) {
      this.transport.send(EVENT_AWARENESS, {
        update: toBase64(
          encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]),
        ),
      });
    }
  };

  private onSyncReply = (payload: Record<string, unknown>) => {
    const update = fromBase64(payload.update);
    if (update) Y.applyUpdate(this.doc, update, this);

    this.sawPeer = true;
    if (this.syncResolve) {
      this.syncResolve(false);
      this.syncResolve = null;
    }
  };

  private onRemoteAwareness = (payload: Record<string, unknown>) => {
    const update = fromBase64(payload.update);
    if (update) applyAwarenessUpdate(this.awareness, update, this);
  };
}

// ---------------------------------------------------------------------------
// Broadcast payloads have to survive JSON, so the binary updates travel as
// base64 rather than as raw bytes.
// ---------------------------------------------------------------------------
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
}

export function fromBase64(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (typeof atob === 'function') {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/** A stable colour per person, so the same editor is the same colour to everyone. */
const CURSOR_COLORS = [
  '#EC4899', '#BE185D', '#0EA5E9', '#2DD4BF', '#8E6C86', '#DB2777', '#7C3AED',
];

export function cursorColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length] ?? '#EC4899';
}
