import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';

/**
 * The collaboration relay.
 *
 * Supabase Realtime gave editors a websocket to shout Yjs updates over. There
 * is no such channel in front of Aurora, so peers post updates here and poll
 * for the ones they have not seen. It is chattier than a socket, but it works
 * on any host — including serverless ones that will not hold a connection
 * open — and it needs no service beyond the database the app already has.
 *
 * Authorisation is not decided here: both statements go through the signed-in
 * user's session, so `collab_messages`' own policies allow the read only if
 * the document is visible and the write only if it is editable.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Never hand back an unbounded backlog. */
const MAX_MESSAGES = 200;

/**
 * How recently another editor must have been heard from to count as present.
 * Comfortably longer than the transport's heartbeat, so a quiet peer that is
 * still sitting on the document is not mistaken for an empty room.
 */
const PRESENCE_WINDOW_SECONDS = 30;

interface Params {
  params: Promise<{ documentId: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { documentId } = await params;
  if (!UUID.test(documentId)) {
    return NextResponse.json({ error: 'Bad document id' }, { status: 400 });
  }

  const url = new URL(request.url);
  const after = Number(url.searchParams.get('after') ?? '0');
  const sender = url.searchParams.get('sender') ?? '';

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('collab_messages')
    .select('id, sender, event, payload')
    .eq('document_id', documentId)
    .gt('id', Number.isFinite(after) ? after : 0)
    .order('id', { ascending: true })
    .limit(MAX_MESSAGES);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // `after=0` is a client joining. That happens once per editor session, which
  // makes it the right moment to age out relay traffic nobody can still need —
  // no scheduler required.
  if (after === 0) void db.rpc('app.prune_collab_messages');

  const rows = (data ?? []) as { id: number; sender: string; event: string; payload: unknown }[];
  // A peer's own updates are already applied locally; echoing them back would
  // be harmless (Yjs updates are idempotent) but wastes a round of work.
  const messages = rows.filter((m) => m.sender !== sender);
  const cursor = rows.length > 0 ? rows[rows.length - 1]!.id : after;

  // Who is responsible for seeding this document from the database.
  //
  // A joiner otherwise has no way to tell "nobody has answered yet" from
  // "nobody is here", so it must sit out the full sync grace before it dares
  // seed — on every open, including the overwhelmingly common case of editing
  // alone. Worse, two editors opening at the same moment can both conclude
  // they were first and seed the content twice.
  //
  // The relay settles it instead: whoever's earliest message still inside the
  // presence window is the oldest is the seeder. The database serialises those
  // inserts, so exactly one client gets the answer "you", however close
  // together they arrived.
  const since = new Date(Date.now() - PRESENCE_WINDOW_SECONDS * 1000).toISOString();

  const { data: presence } = await db
    .from('collab_messages')
    .select('id, sender')
    .eq('document_id', documentId)
    .gt('created_at', since)
    .order('id', { ascending: true })
    .limit(1);

  const seeder = ((presence ?? []) as { sender: string }[])[0]?.sender ?? null;

  return NextResponse.json(
    { messages, cursor, seeder },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { documentId } = await params;
  if (!UUID.test(documentId)) {
    return NextResponse.json({ error: 'Bad document id' }, { status: 400 });
  }

  let body: { sender?: unknown; event?: unknown; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad body' }, { status: 400 });
  }

  const sender = typeof body.sender === 'string' ? body.sender : '';
  const event = typeof body.event === 'string' ? body.event : '';
  if (!sender || !event) {
    return NextResponse.json({ error: 'sender and event are required' }, { status: 400 });
  }

  const db = await userClient(user.id);
  const { error } = await db.from('collab_messages').insert({
    document_id: documentId,
    sender,
    event,
    payload: body.payload ?? {},
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
