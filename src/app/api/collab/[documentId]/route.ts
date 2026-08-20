import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db/client';
import { publish, subscribe, type Message } from '@/lib/collab/hub';

/** Holds a stream open and reaches the database, so: Node runtime, never cached. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The collaboration channel for one document.
 *
 * `GET` opens a Server-Sent Events stream carrying other people's edits;
 * `POST` submits one of your own. SSE rather than a websocket because Next
 * route handlers speak it natively — no second server, no upgrade handshake,
 * and it survives a proxy that would drop an idle socket.
 *
 * Both verbs check that the caller may actually open the document, under their
 * own database role. Without that, knowing a document id would be enough to
 * read every edit made to it.
 */

/** Silence closes intermediaries. A comment every 25s keeps the stream alive. */
const HEARTBEAT_MS = 25_000;

async function mayOpen(userId: string, documentId: string): Promise<boolean> {
  const { data } = await asUser(userId)
    .from('documents')
    .select('id')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle();

  return data !== null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse('Not signed in', { status: 401 });

  const { documentId } = await context.params;
  if (!(await mayOpen(user.id, documentId))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const clientId = new URL(request.url).searchParams.get('client');
  if (!clientId) return new NextResponse('Missing client id', { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let open = true;

      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };

      const unsubscribe = subscribe(documentId, clientId, (message: Message) => {
        write(`data: ${JSON.stringify(message)}\n\n`);
      });

      const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      // A tab that navigates away aborts the request; without this the
      // subscriber would linger and the heartbeat would run forever.
      request.signal.addEventListener('abort', close);

      // Tells the client it has joined, which is what `connect()` waits for.
      write(`data: ${JSON.stringify({ event: 'ready', payload: {} })}\n\n`);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx buffers proxied responses by default, which would hold every
      // edit until the buffer filled.
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse('Not signed in', { status: 401 });

  const { documentId } = await context.params;
  if (!(await mayOpen(user.id, documentId))) {
    return new NextResponse('Not found', { status: 404 });
  }

  let body: { client?: string; event?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return new NextResponse('Expected JSON', { status: 400 });
  }

  if (!body.client || !body.event) {
    return new NextResponse('Missing client or event', { status: 400 });
  }

  const delivered = publish(documentId, body.client, {
    event: body.event,
    payload: body.payload ?? {},
  });

  return NextResponse.json({ delivered });
}
