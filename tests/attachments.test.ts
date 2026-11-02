/**
 * The three decisions that make a stored file safe, tested away from the
 * database and the browser.
 *
 * A filename becomes a Content-Disposition header, a MIME type decides whether
 * the browser is allowed to render bytes somebody uploaded, and the size limit
 * is the one thing standing between a school portal and a database bill. None
 * of them can be checked by looking at the page, so they are checked here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHUNK_BYTES,
  MAX_UPLOAD_BYTES,
  canRenderInline,
  extensionOf,
  formatBytes,
  isParentType,
  kindOf,
  safeFileName,
  safeMimeType,
} from "../src/lib/attachments";

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

test("a filename cannot imply a directory", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("C:\\Users\\paint\\deck.pptx"), "deck.pptx");
  assert.equal(safeFileName("/var/log/syslog"), "syslog");
});

test("a filename cannot break out of the header it is written into", () => {
  // A quote or a newline here would let the name close the filename parameter
  // and start inventing headers of its own.
  assert.equal(safeFileName('poster".pdf'), "poster.pdf");
  assert.equal(safeFileName("poster\r\nX-Evil: 1.pdf"), "posterX-Evil: 1.pdf");
  // A Windows path separator is a path separator, so the last segment wins.
  assert.equal(safeFileName("back\\slash.png"), "slash.png");
});

test("a dotfile does not stay hidden, and an empty name still has one", () => {
  assert.equal(safeFileName(".gitignore"), "gitignore");
  assert.equal(safeFileName("   "), "file");
  assert.equal(safeFileName(""), "file");
});

test("a long filename is cut rather than refused", () => {
  const name = `${"a".repeat(400)}.png`;
  assert.equal(safeFileName(name).length, 200);
});

test("Thai and emoji survive, because people name files in their own language", () => {
  assert.equal(safeFileName("โปสเตอร์.pdf"), "โปสเตอร์.pdf");
  assert.equal(safeFileName("poster 🎨 final.png"), "poster 🎨 final.png");
});

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

test("the extension decides the type, not what the browser claimed", () => {
  // The whole attack: upload HTML, declare it an image, have it served back as
  // a page on the origin holding everybody's session cookie.
  assert.equal(safeMimeType("image/png", "payload.html"), "application/octet-stream");
  assert.equal(safeMimeType("text/html", "logo.png"), "image/png");
});

test("markup and vector types are never renderable inline", () => {
  for (const name of ["evil.html", "evil.htm", "evil.svg", "evil.xhtml", "evil.xml"]) {
    assert.equal(canRenderInline(safeMimeType("", name)), false, name);
  }
  // SVG in particular: an image that carries <script>.
  assert.equal(canRenderInline("image/svg+xml"), false);
  assert.equal(canRenderInline("text/html"), false);
});

test("the ordinary types a team actually shares are recognised", () => {
  assert.equal(safeMimeType("", "poster.pdf"), "application/pdf");
  assert.equal(safeMimeType("", "roster.csv"), "text/csv");
  assert.equal(safeMimeType("", "deck.pptx"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(safeMimeType("", "clip.MP4"), "video/mp4");
});

test("only images, PDFs, media and plain text may be shown in a tab", () => {
  assert.equal(canRenderInline("image/png"), true);
  assert.equal(canRenderInline("image/jpeg"), true);
  assert.equal(canRenderInline("application/pdf"), true);
  assert.equal(canRenderInline("application/octet-stream"), false);
  assert.equal(canRenderInline("video/mp4"), true);
  assert.equal(canRenderInline("text/csv"), true);
  // Markup that can run script never renders, whatever it is called.
  assert.equal(canRenderInline("text/html"), false);
  assert.equal(canRenderInline("image/svg+xml"), false);
  assert.equal(canRenderInline("application/xhtml+xml"), false);
});

test("a malformed content type falls back to a byte stream", () => {
  for (const declared of [
    "",
    "not a type",
    "text/html; charset=utf-8\r\nX-Evil: 1",
    "image/png; boundary=x",
    "../../etc",
  ]) {
    assert.equal(safeMimeType(declared, "mystery"), "application/octet-stream", declared);
  }
});

test("an unknown extension never becomes something the browser will render", () => {
  // A well-formed declared type is kept as a label, because "thing.qqq" is
  // more useful to a person than "application/octet-stream" — but never as one
  // that could be shown in a tab, and the download route serves anything
  // outside the inline allowlist as a byte stream regardless.
  const stored = safeMimeType("application/x-made-up", "thing.qqq");
  assert.equal(stored, "application/x-made-up");
  assert.equal(canRenderInline(stored), false);

  // The case that matters: a claim of an inline type with nothing to back it.
  for (const claim of ["image/png", "image/jpeg", "application/pdf"]) {
    const forged = safeMimeType(claim, "payload.qqq");
    assert.equal(forged, "application/octet-stream", claim);
    assert.equal(canRenderInline(forged), false, claim);
  }

  assert.equal(extensionOf("no-extension"), "");
  assert.equal(extensionOf("archive.tar.gz"), "gz");
});

// ---------------------------------------------------------------------------
// Sizes and shapes
// ---------------------------------------------------------------------------

test("chunks stay small enough for one TiDB transaction entry", () => {
  assert.ok(CHUNK_BYTES <= 512 * 1024, "a chunk must stay well under the entry limit");
  assert.ok(MAX_UPLOAD_BYTES > CHUNK_BYTES, "an upload has to be at least one chunk");
  // The Server Action body limit in next.config.ts is 24 MB; the upload limit
  // has to leave room for multipart overhead underneath it.
  assert.ok(MAX_UPLOAD_BYTES <= 20 * 1024 * 1024);
});

test("sizes read the way a person would say them", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(900), "900 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(1_500_000), "1.4 MB");
  assert.equal(formatBytes(12_000_000), "11.4 MB");
  assert.equal(formatBytes(10 * 1024 * 1024), "10 MB");
});

test("parent types are a closed list", () => {
  assert.equal(isParentType("assignment"), true);
  assert.equal(isParentType("document"), true);
  // Anything else has no permission rule to run, so it is refused rather than
  // defaulted — a default here would store a file nobody is responsible for.
  assert.equal(isParentType("session"), false);
  assert.equal(isParentType("user; DROP TABLE"), false);
  assert.equal(isParentType(""), false);
});

test("an icon is chosen for every type, never undefined", () => {
  assert.equal(kindOf("image/png"), "image");
  assert.equal(kindOf("application/pdf"), "pdf");
  assert.equal(kindOf("video/mp4"), "video");
  assert.equal(kindOf("audio/mpeg"), "audio");
  assert.equal(
    kindOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "doc",
  );
  assert.equal(kindOf("application/octet-stream"), "file");
});
