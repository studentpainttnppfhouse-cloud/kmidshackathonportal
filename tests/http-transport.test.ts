/**
 * The polling relay, against an in-memory stand-in for the API route.
 *
 * The case that matters is the join handshake. Over a websocket a peer's sync
 * reply came back in milliseconds; over polling it takes a post, the peer's
 * poll, its reply and our next poll. If the provider gives up waiting too
 * early, both editors decide they are first, both seed the document from the
 * database, and the content is doubled. These tests pin that down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CollabProvider } from '@/lib/collab/provider';
import { createHttpTransport } from '@/lib/collab/http-transport';

interface Stored {
  id: number;
  document_id: string;
  sender: string;
  event: string;
  payload: Record<string, unknown>;
}

/** `/api/collab/<id>` — the document the request is for. */
function docId(url: URL): string {
  return url.pathname.split('/').pop() ?? '';
}

/** Stands in for /api/collab/[documentId], including the sender filter. */
function relay() {
  const rows: Stored[] = [];
  let nextId = 1;

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');

    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Omit<Stored, 'id' | 'document_id'>;
      rows.push({ id: nextId++, document_id: docId(url), ...body });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const after = Number(url.searchParams.get('after') ?? '0');
    const sender = url.searchParams.get('sender') ?? '';
    const fresh = rows.filter((r) => r.id > after);
    const messages = fresh.filter((r) => r.sender !== sender);
    const cursor = fresh.length > 0 ? fresh[fresh.length - 1]!.id : after;
    // The seeder is whoever's earliest surviving message is oldest, exactly as
    // the route computes it.
    const seeder = rows.find((r) => r.document_id === docId(url))?.sender ?? null;
    return new Response(JSON.stringify({ messages, cursor, seeder }), { status: 200 });
  };

  return { rows, fetchImpl };
}

describe('http collaboration transport', () => {
  let store: ReturnType<typeof relay>;

  beforeEach(() => {
    store = relay();
    vi.stubGlobal('fetch', store.fetchImpl as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for more grace than a websocket transport would', () => {
    const transport = createHttpTransport('doc-1', '1');
    expect(transport.syncGraceMs).toBeGreaterThan(1000);
    transport.disconnect();
  });

  it('connects and reports live', async () => {
    const transport = createHttpTransport('doc-1', '1');
    await expect(transport.connect()).resolves.toBe(true);
    transport.disconnect();
  });

  it('falls back to solo when the relay is unreachable', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    const transport = createHttpTransport('doc-1', '1');
    await expect(transport.connect()).resolves.toBe(false);
    transport.disconnect();
  });

  it('does not deliver a sender its own messages', async () => {
    const mine = createHttpTransport('doc-1', 'me');
    const received: string[] = [];
    mine.on('yjs-update', () => received.push('mine'));
    await mine.connect();

    mine.send('yjs-update', { update: 'abc' });
    await vi.waitFor(() => expect(store.rows).toHaveLength(1), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 600));

    expect(received).toHaveLength(0);
    mine.disconnect();
  });

  it('starts immediately when nobody else is on the document', async () => {
    const doc = new Y.Doc();
    const provider = new CollabProvider(
      createHttpTransport('doc-solo', String(doc.clientID)),
      { name: 'A', color: '#f0f' },
      doc,
    );

    const started = Date.now();
    const result = await provider.connect();
    const took = Date.now() - started;

    expect(result).toEqual({ connected: true, isFirst: true });
    // The whole point: an editor opened alone must not sit out the sync grace.
    expect(took).toBeLessThan(1000);
    expect(store.rows.some((r) => r.event === 'presence')).toBe(true);

    provider.destroy();
  });

  it('tells the second joiner it is NOT first, so content is not doubled', async () => {
    const docA = new Y.Doc();
    const first = new CollabProvider(
      createHttpTransport('doc-1', String(docA.clientID)),
      { name: 'A', color: '#f0f' },
      docA,
    );
    const firstResult = await first.connect();
    expect(firstResult.connected).toBe(true);
    expect(firstResult.isFirst).toBe(true);

    // The first editor seeds the document, as the page would.
    docA.getXmlFragment('default').insert(0, [new Y.XmlText('Run of show')]);

    const docB = new Y.Doc();
    const second = new CollabProvider(
      createHttpTransport('doc-1', String(docB.clientID)),
      { name: 'B', color: '#0ff' },
      docB,
    );
    const secondResult = await second.connect();

    expect(secondResult.connected).toBe(true);
    expect(secondResult.isFirst).toBe(false);

    first.destroy();
    second.destroy();
  }, 20000);

  it('converges two editors typing at once', async () => {
    const docA = new Y.Doc();
    const a = new CollabProvider(
      createHttpTransport('doc-2', String(docA.clientID)),
      { name: 'A', color: '#f0f' },
      docA,
    );
    await a.connect();

    const docB = new Y.Doc();
    const b = new CollabProvider(
      createHttpTransport('doc-2', String(docB.clientID)),
      { name: 'B', color: '#0ff' },
      docB,
    );
    await b.connect();

    docA.getText('t').insert(0, 'hello ');
    docB.getText('t').insert(0, 'world ');

    await vi.waitFor(
      () => {
        expect(docA.getText('t').toString()).toBe(docB.getText('t').toString());
        expect(docA.getText('t').toString().length).toBe(12);
      },
      { timeout: 10000, interval: 100 },
    );

    a.destroy();
    b.destroy();
  }, 20000);
});
