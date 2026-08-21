import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/pg/server';
import { audit } from '@/lib/audit';
import { docxFromTiptap, htmlFromTiptap } from '@/lib/export/document-export';

/**
 * Document export (§5.6).
 *
 * DOCX is generated as a WordprocessingML document, which Word, Pages and
 * Google Docs all open natively and which needs no binary library.
 *
 * "PDF" is served as a print-ready HTML page that opens the browser's own
 * print dialogue. Rendering a real PDF server-side would mean shipping a
 * headless browser, which is a lot of weight on a Vercel function for a
 * feature students will use a handful of times a term. The output is
 * identical once printed; the trade is documented in README.md.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { id } = await params;
  const format = request.nextUrl.searchParams.get('format') === 'docx' ? 'docx' : 'pdf';

  const db = await userClient(user.id);
  const { data: doc } = await db
    .from('documents')
    .select('id, title, content')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const row = doc as { id: string; title: string; content: object };
  const safeName = row.title.replace(/[^\w\d\- ]+/g, '').trim() || 'document';

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'document.exported',
    targetType: 'document',
    targetId: row.id,
    targetLabel: row.title,
    diff: { format },
  });

  if (format === 'docx') {
    const buffer = await docxFromTiptap(row.title, row.content);
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeName}.docx"`,
      },
    });
  }

  return new NextResponse(htmlFromTiptap(row.title, row.content), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
