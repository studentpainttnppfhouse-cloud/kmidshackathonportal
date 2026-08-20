import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  CollabProvider, cursorColorFor, fromBase64, toBase64, type Transport,
} from '@/lib/collab/provider';

/**
 * An in-memory stand-in for the collaboration channel, so the merge and
 * hand-off logic can be tested without a network. Messages are delivered to
 * every peer except the sender, which is what the hub behind /api/collab does
 * in production.
 */
class Hub {
  private peers: Array<{ id: number; handlers: Map<string, (p: Record<string, unknown>) => void> }> = [];
  private nextId = 1;

  transport(available = true): Transport {
    const id = this.nextId++;
    const handlers = new Map<string, (p: Record<string, unknown>) => void>();
    const peer = { id, handlers };

    return {
      on: (event, handler) => { handlers.set(event, handler); },
      send: (event, payload) => {
        // Round-trip through JSON, exactly as a real broadcast would.
        const encoded = JSON.parse(JSON.stringify(payload));
        for (const other of this.peers) {
          if (other.id === id) continue;
          other.handlers.get(event)?.(encoded);
        }
      },
      connect: async () => {
        if (!available) return false;
        this.peers.push(peer);
        return true;
      },
      disconnect: () => {
        this.peers = this.peers.filter((p) => p.id !== id);
      },
    };
  }
}

const ALICE = { name: 'Prae', color: '#EC4899' };
const BOB = { name: 'Napat', color: '#0EA5E9' };

function text(doc: Y.Doc) {
  return doc.getText('body').toString();
}

describe('base64 transport encoding', () => {
  it('round-trips binary Yjs updates through JSON', () => {
    const doc = new Y.Doc();
    doc.getText('body').insert(0, 'MedTech & Digital Health');
    const update = Y.encodeStateAsUpdate(doc);

    const encoded = JSON.parse(JSON.stringify({ u: toBase64(update) })).u;
    const decoded = fromBase64(encoded);

    expect(decoded).not.toBeNull();
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, decoded!);
    expect(text(rebuilt)).toBe('MedTech & Digital Health');
  });

  it('returns null for a missing or malformed payload', () => {
    expect(fromBase64(undefined)).toBeNull();
    expect(fromBase64('')).toBeNull();
    expect(fromBase64(42)).toBeNull();
  });
});

describe('two editors on one document', () => {
  it('tells the first joiner it is responsible for seeding', async () => {
    const hub = new Hub();
    const alice = new CollabProvider(hub.transport(), ALICE);
    const first = await alice.connect();
    expect(first).toEqual({ connected: true, isFirst: true });
    alice.destroy();
  });

  it('tells a later joiner NOT to seed, so content is not doubled', async () => {
    const hub = new Hub();
    const alice = new CollabProvider(hub.transport(), ALICE);
    await alice.connect();
    // Alice seeds.
    alice.doc.getText('body').insert(0, 'Judging rubric');

    const bob = new CollabProvider(hub.transport(), BOB);
    const result = await bob.connect();

    expect(result.isFirst).toBe(false);
    // Bob received the state rather than starting empty.
    expect(text(bob.doc)).toBe('Judging rubric');

    alice.destroy();
    bob.destroy();
  });

  it('converges when both type at once', async () => {
    const hub = new Hub();
    const alice = new CollabProvider(hub.transport(), ALICE);
    await alice.connect();
    const bob = new CollabProvider(hub.transport(), BOB);
    await bob.connect();

    // Concurrent edits at opposite ends — the case that plain autosave loses.
    alice.doc.getText('body').insert(0, 'Clinical impact 40%. ');
    bob.doc.getText('body').insert(0, 'Feasibility 25%. ');

    expect(text(alice.doc)).toBe(text(bob.doc));
    expect(text(alice.doc)).toContain('Clinical impact 40%.');
    expect(text(alice.doc)).toContain('Feasibility 25%.');

    alice.destroy();
    bob.destroy();
  });

  it('does not echo a peer update back to the sender', async () => {
    const hub = new Hub();
    const alice = new CollabProvider(hub.transport(), ALICE);
    await alice.connect();
    const bob = new CollabProvider(hub.transport(), BOB);
    await bob.connect();

    const spy = vi.fn();
    bob.doc.on('update', spy);
    alice.doc.getText('body').insert(0, 'x');

    // Bob applies it once. An echo would show as a second update and, in a
    // longer chain, as a broadcast storm.
    expect(spy).toHaveBeenCalledTimes(1);

    alice.destroy();
    bob.destroy();
  });

  it('shares presence so cursors can be drawn', async () => {
    const hub = new Hub();
    const alice = new CollabProvider(hub.transport(), ALICE);
    await alice.connect();
    const bob = new CollabProvider(hub.transport(), BOB);
    await bob.connect();

    // Nudge awareness so the state is broadcast.
    alice.awareness.setLocalStateField('user', ALICE);
    bob.awareness.setLocalStateField('user', BOB);

    const namesSeenByBob = [...bob.awareness.getStates().values()]
      .map((s) => (s as { user?: { name: string } }).user?.name)
      .filter(Boolean)
      .sort();

    expect(namesSeenByBob).toContain('Napat');
    expect(namesSeenByBob).toContain('Prae');

    alice.destroy();
    bob.destroy();
  });

  it('drops a peer from presence when it disconnects', async () => {
    const hub = new Hub();
    const alice = new CollabProvider(hub.transport(), ALICE);
    await alice.connect();
    const bob = new CollabProvider(hub.transport(), BOB);
    await bob.connect();
    alice.awareness.setLocalStateField('user', ALICE);

    expect(bob.awareness.getStates().size).toBeGreaterThan(1);
    alice.destroy();
    expect([...bob.awareness.getStates().keys()]).not.toContain(alice.doc.clientID);

    bob.destroy();
  });
});

describe('when Realtime is unavailable', () => {
  it('reports not connected instead of hanging', async () => {
    const hub = new Hub();
    const solo = new CollabProvider(hub.transport(false), ALICE);
    const result = await solo.connect();

    expect(result).toEqual({ connected: false, isFirst: true });
    expect(solo.isConnected).toBe(false);
    solo.destroy();
  });

  it('still allows local editing', async () => {
    const hub = new Hub();
    const solo = new CollabProvider(hub.transport(false), ALICE);
    await solo.connect();
    solo.doc.getText('body').insert(0, 'offline edit');
    expect(text(solo.doc)).toBe('offline edit');
    solo.destroy();
  });
});

describe('cursor colours', () => {
  it('are stable for the same person', () => {
    expect(cursorColorFor('praewa@kmids.ac.th')).toBe(cursorColorFor('praewa@kmids.ac.th'));
  });

  it('differ between people', () => {
    const colors = new Set(
      ['praewa', 'napat', 'mint', 'kao', 'ploy'].map(cursorColorFor),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
