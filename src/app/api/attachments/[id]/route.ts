import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/session";
import { resolveParent } from "@/lib/attachment-access";
import { CHUNK_BYTES, canRenderInline } from "@/lib/attachments";
import { safeHref } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Handing a stored file back.
 *
 * Three things make this safe to have on the same origin as everybody's
 * session cookie:
 *
 *   1. Authorisation is re-derived from the parent on every request, by the
 *      same function the upload used. An attachment id is not a capability —
 *      knowing one gets you nothing you could not already read.
 *   2. Only an allowlist of types is served as itself. Everything else comes
 *      back as `application/octet-stream` with a download disposition, so an
 *      HTML file somebody uploaded is a file, not a page on this site that can
 *      read the DOM around it. `nosniff` stops the browser second-guessing
 *      that, and a `default-src 'none'; sandbox` policy on the response means
 *      even a type that slipped through the allowlist runs nothing.
 *   3. The body is streamed a chunk at a time. A 10 MB download does not put
 *      10 MB on the heap of a 512 MB instance, and ten at once do not put 100.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer();
  // 404 rather than 401: an unauthenticated request should not be able to tell
  // a real attachment id from a made-up one.
  if (!viewer) return new NextResponse("Not found", { status: 404 });

  const { id } = await params;
  const attachment = await db.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      parentType: true,
      parentId: true,
      name: true,
      mimeType: true,
      size: true,
      storage: true,
      externalUrl: true,
      deletedAt: true,
    },
  });

  if (!attachment || attachment.deletedAt) {
    return new NextResponse("Not found", { status: 404 });
  }

  const parent = await resolveParent(viewer, attachment.parentType, attachment.parentId);
  if (!parent.canRead) return new NextResponse("Not found", { status: 404 });

  // A "link" attachment holds no bytes. It bounces, and only ever to a URL that
  // passes the same http/https allowlist every other link in the portal does.
  if (attachment.storage === "link") {
    const href = safeHref(attachment.externalUrl);
    if (!href) return new NextResponse("Not found", { status: 404 });
    return NextResponse.redirect(href, 302);
  }

  const inline =
    request.nextUrl.searchParams.get("inline") === "1" && canRenderInline(attachment.mimeType);

  const contentType = canRenderInline(attachment.mimeType)
    ? attachment.mimeType
    : "application/octet-stream";

  // RFC 5987: the plain `filename` is the ASCII fallback, `filename*` carries
  // the Thai and the emoji that the plain one cannot.
  const asciiName = attachment.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const disposition = `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`;

  // Byte ranges, so a video can seek and Safari will play it at all.
  let start = 0;
  let end = attachment.size - 1;
  let partial = false;
  const range = request.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && attachment.size > 0 && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), attachment.size - 1);
    } else {
      start = Math.max(0, attachment.size - Number(m[2]));
    }
    if (start > end || start >= attachment.size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "content-range": `bytes */${attachment.size}` },
      });
    }
    partial = true;
  }

  const firstChunk = Math.floor(start / CHUNK_BYTES);
  const lastChunk = attachment.size === 0 ? 0 : Math.floor(end / CHUNK_BYTES);

  // Declared before the stream: `pull` can fire synchronously as the stream is
  // constructed, and a temporal-dead-zone read there would fail the download
  // for a reason nothing in the response would explain.
  let idx = firstChunk;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // One chunk per pull, so the whole file is never in memory at once.
      if (idx > lastChunk) {
        controller.close();
        return;
      }
      const current = idx;
      idx += 1;

      const chunk = await db.attachmentChunk.findUnique({
        where: { attachmentId_idx: { attachmentId: attachment.id, idx: current } },
        select: { bytes: true },
      });

      if (!chunk) {
        if (attachment.size === 0) {
          controller.close();
          return;
        }
        // A truncated file that ends quietly is worse than one that errors.
        controller.error(new Error("attachment chunk missing"));
        return;
      }

      const bytes = new Uint8Array(chunk.bytes);
      const base = current * CHUNK_BYTES;
      const from = Math.max(0, start - base);
      const to = Math.min(bytes.length, end - base + 1);
      controller.enqueue(from === 0 && to === bytes.length ? bytes : bytes.subarray(from, to));
    },
  });

  return new NextResponse(body, {
    status: partial ? 206 : 200,
    headers: {
      "content-type": contentType.startsWith("text/") ? `${contentType}; charset=utf-8` : contentType,
      "content-length": String(attachment.size === 0 ? 0 : end - start + 1),
      "accept-ranges": "bytes",
      ...(partial ? { "content-range": `bytes ${start}-${end}/${attachment.size}` } : {}),
      "content-disposition": disposition,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
      // Private, because the bytes are behind a permission check and a shared
      // cache holding them would hand them to the next person through.
      "cache-control": "private, no-store, must-revalidate",
    },
  });
}
