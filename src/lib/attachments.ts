/**
 * Files, in the database.
 *
 * This revises decision D2-1, which said the portal stores links and never
 * bytes. That decision was right about Render's disk — it is wiped on every
 * deploy, so an uploads directory is a directory of files that disappear next
 * Tuesday — and wrong about the conclusion it drew, because the disk was never
 * the only place to put a file. TiDB survives every redeploy the disk does not.
 *
 * So bytes live in `attachment_chunks`, and:
 *
 *   - a file attached from a phone at the back of a classroom is still there
 *     after the next deploy, on every other device that signs in;
 *   - there is one backup story, not two: the JSON export and the database
 *     dump already cover it;
 *   - "who can read this file" is the same question as "who can read the task
 *     it hangs off", answered by the same policy module.
 *
 * The old link path has not gone anywhere. Over the size limit, an attachment
 * keeps its name and points at Drive, which is the honest answer for a 400 MB
 * export video: the portal was never going to be the right home for that.
 */

/** Anything at or under this uploads into the database. */
export const MAX_UPLOAD_BYTES = readLimitMb() * 1024 * 1024;

/**
 * 256 KB per row.
 *
 * TiDB caps the size of a single transaction entry, and one 10 MB blob in one
 * row is a row that every query touching the table has to drag across the
 * network. Chunking keeps each write small and lets a download hold one piece
 * in memory at a time instead of the whole file.
 */
export const CHUNK_BYTES = 256 * 1024;

/** How many files one upload may carry. */
export const MAX_FILES_PER_UPLOAD = 10;

function readLimitMb(): number {
  const raw = Number(process.env.MAX_UPLOAD_MB);
  if (!Number.isFinite(raw) || raw <= 0) return 10;
  // Capped rather than trusted: the Server Action body limit in next.config.ts
  // is the real ceiling, and a MAX_UPLOAD_MB above it would only produce
  // uploads that fail after the person has waited for them.
  return Math.min(Math.floor(raw), 20);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  // One decimal, with a trailing ".0" dropped: "11.4 MB" is the number a
  // person needs when a 10 MB limit just refused their file, and "10 MB" is
  // how that limit should read when it is stated on its own.
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `${mb.endsWith(".0") ? mb.slice(0, -2) : mb} MB`;
}

export const MAX_UPLOAD_LABEL = formatBytes(MAX_UPLOAD_BYTES);

// ---------------------------------------------------------------------------
// What an attachment can hang off
// ---------------------------------------------------------------------------

/**
 * The parents an attachment may name.
 *
 * A closed list, because `parentType` decides which permission check runs. An
 * unknown value has no check to run, so it is refused rather than defaulted —
 * a default here would be a way to store a file nobody is responsible for.
 */
export const PARENT_TYPES = [
  "assignment",
  "document",
  "announcement",
  "file",
  "form_response",
  "user",
] as const;

export type ParentType = (typeof PARENT_TYPES)[number];

export function isParentType(value: string): value is ParentType {
  return (PARENT_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Names and types
// ---------------------------------------------------------------------------

/**
 * A filename that is safe to store and to put in a Content-Disposition header.
 *
 * Two separate problems. Path separators and `..` would let a name imply a
 * directory it has no business implying; control characters and quotes would
 * let one break out of the header it is written into and add headers of its
 * own. Both are stripped rather than escaped, because nothing legitimate is
 * lost by refusing a newline in a filename.
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";

  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200);

  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * Types that may be served inline, and everything else that may not.
 *
 * A file the portal serves comes back from the portal's own origin, which is
 * the origin holding everybody's session cookie. So an HTML file served inline
 * is not a file — it is a page on this site, written by whoever uploaded it,
 * and it can read the DOM of the site that served it. SVG is the same problem
 * wearing an image's clothes: it carries `<script>`.
 *
 * Hence the allowlist. Anything on it is served as itself and may render in a
 * tab; anything else is served as a byte stream with a download disposition,
 * whatever the browser claimed it was on the way in.
 */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  // Media plays in <video>/<audio>, which runs no script from the file.
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  // Plain text cannot run anything; nosniff and the sandbox keep it text.
  "text/plain",
  "text/csv",
  "text/markdown",
]);

/** Extension → type, for the browsers that send `application/octet-stream`. */
const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4: "video/mp4",
  webm: "video/webm",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ai: "application/postscript",
  psd: "image/vnd.adobe.photoshop",
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * The type an attachment is *stored* as.
 *
 * The extension decides, and nothing else does. `File.type` is a string the
 * client chose, so it is never the reason a file becomes renderable: an
 * unrecognised extension is a byte stream even when the browser insists it is
 * a PNG, which is what closes the "upload markup, declare it an image" path.
 *
 * The declared type is still kept when the extension says nothing at all —
 * a file with no extension gets a label rather than a shrug — but only after
 * being checked for the header-splitting characters a value copied into a
 * response header must not contain, and only as a type that will be served as
 * a download, because `canRenderInline()` reads the same allowlist this does.
 */
export function safeMimeType(declared: string, fileName: string): string {
  const byExtension = BY_EXTENSION[extensionOf(fileName)];
  if (byExtension) return byExtension;

  const trimmed = declared.trim().toLowerCase().slice(0, 120);
  // Simple `type/subtype`, no parameters, no separators that could be smuggled
  // into a response header.
  const wellFormed = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,60}$/.test(
    trimmed,
  );

  // Never an inline type. If the extension did not vouch for it, the bytes
  // come back as a download whatever they claim to be.
  return wellFormed && !INLINE_TYPES.has(trimmed) ? trimmed : "application/octet-stream";
}

export function canRenderInline(mimeType: string): boolean {
  return INLINE_TYPES.has(mimeType);
}

/** Just enough of a type to pick an icon for the list. */
export function kindOf(mimeType: string): "image" | "pdf" | "video" | "audio" | "doc" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.includes("word") || mimeType.includes("sheet") || mimeType.includes("presentation")) {
    return "doc";
  }
  return "file";
}

export const KIND_ICON: Record<ReturnType<typeof kindOf>, string> = {
  image: "🖼",
  pdf: "📄",
  video: "🎬",
  audio: "🎵",
  doc: "📝",
  file: "📎",
};
