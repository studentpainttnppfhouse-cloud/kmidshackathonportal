import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { readLocalObject } from '@/lib/storage';

/**
 * Serves files held by the local storage driver (`npm run dev:local`).
 *
 * S3 hands the browser a pre-signed URL and is never routed through the app;
 * a directory on disk has no such thing, so this stands in for it. It requires
 * a session for the same reason the signed URL expires: a stored file is not
 * public just because someone knows its name.
 *
 * Returns 404 when the S3 driver is in use, so no deployment can accidentally
 * end up serving objects through the app.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { key } = await params;
  const path = key.map(decodeURIComponent).join('/');

  const body = await readLocalObject(path);
  if (!body) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return new NextResponse(Buffer.from(body), {
    headers: {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      // Never let a shared cache hold a file that needed a session to fetch.
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
    },
  });
}
