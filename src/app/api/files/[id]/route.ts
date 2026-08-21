import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getBlob } from '@/lib/files/storage';
import { audit } from '@/lib/audit';

/** `pg` needs Node APIs, so this cannot run on the edge runtime. */
export const runtime = 'nodejs';

/**
 * Serves an uploaded file.
 *
 * Every download goes through here rather than through a public URL, which is
 * what lets the department rules apply to the bytes and not just to the row in
 * the library — and what makes `file.downloaded` a real entry in the audit log
 * rather than a guess.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse('Not signed in', { status: 401 });

  const { id } = await context.params;
  const blob = await getBlob(user.id, id);

  if (!blob) return new NextResponse('Not found', { status: 404 });

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'file.downloaded',
    targetType: 'file',
    targetId: id,
    targetLabel: blob.name,
  });

  return new NextResponse(new Uint8Array(blob.bytes), {
    headers: {
      'Content-Type': contentType(blob.mime),
      'Content-Length': String(blob.bytes.length),
      // `inline` so an image or a PDF opens in the browser; the filename is
      // still what a save produces.
      'Content-Disposition': `inline; filename="${encodeURIComponent(blob.name)}"`,
      // Private: the URL is only meaningful to someone with a session, and a
      // shared cache must never hold one department's file for another's.
      'Cache-Control': 'private, max-age=300',
    },
  });
}

/**
 * Everything is stored and served as UTF-8, but a `text/*` type with no
 * charset leaves the browser to guess — and it guesses Latin-1, which turns
 * every dash and accent in a .txt or .csv into mojibake.
 */
function contentType(mime: string | null): string {
  if (!mime) return 'application/octet-stream';
  if (mime.startsWith('text/') && !mime.includes('charset')) return `${mime}; charset=utf-8`;
  return mime;
}
