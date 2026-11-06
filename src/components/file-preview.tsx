"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/modal";
import { extensionOf, formatBytes } from "@/lib/attachments";

export type PreviewFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storage: string;
  externalUrl: string | null;
};

type Kind = "image" | "video" | "audio" | "pdf" | "text" | "docx" | "sheet" | "link" | "none";

function previewKind(f: PreviewFile): Kind {
  if (f.storage === "link") return "link";
  const ext = extensionOf(f.name);
  if (f.mimeType.startsWith("image/") && f.mimeType !== "image/heic" && !f.mimeType.includes("photoshop")) return "image";
  if (f.mimeType.startsWith("video/")) return "video";
  if (f.mimeType.startsWith("audio/")) return "audio";
  if (f.mimeType === "application/pdf") return "pdf";
  if (f.mimeType.startsWith("text/") || ext === "json") return "text";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "sheet";
  return "none";
}

/** Google Drive / Docs links can be embedded through their own /preview page. */
function driveEmbed(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname !== "drive.google.com" && u.hostname !== "docs.google.com") return null;
    const m = /\/d\/([A-Za-z0-9_-]+)/.exec(u.pathname);
    if (!m) return null;
    const base = u.hostname === "docs.google.com" ? u.pathname.split("/d/")[0] : "/file";
    return `https://${u.hostname}${base}/d/${m[1]}/preview`;
  } catch {
    return null;
  }
}

/** A file name that opens the preview pop-up instead of downloading. */
export function FilePreviewButton({
  file,
  className,
  children,
  mediaDetails = false,
}: {
  file: PreviewFile;
  className?: string;
  children: React.ReactNode;
  mediaDetails?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={file.name}
        description={file.storage === "link" ? "Stored elsewhere" : formatBytes(file.size)}
        size="xl"
      >
        {open ? <PreviewBody file={file} mediaDetails={mediaDetails} /> : null}
      </Modal>
    </>
  );
}

function PreviewBody({ file, mediaDetails }: { file: PreviewFile; mediaDetails: boolean }) {
  const kind = previewKind(file);
  const raw = `/api/attachments/${file.id}`;
  const inline = `${raw}?inline=1`;
  const external = file.storage === "link" ? raw : null;
  const [showImage, setShowImage] = useState(!mediaDetails);
  const showPreview = !mediaDetails || (kind !== "video" && kind !== "link" && (kind !== "image" || showImage));
  const embed = driveEmbed(file.externalUrl);

  return (
    <div className="space-y-3">
      {showPreview ? <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-xl border border-line bg-tint/40">
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={inline} alt={file.name} className="max-h-[70dvh] w-auto max-w-full object-contain" />
        ) : kind === "video" ? (
          <video src={inline} controls playsInline className="max-h-[70dvh] w-full bg-black" />
        ) : kind === "audio" ? (
          <audio src={inline} controls className="w-full p-6" />
        ) : kind === "pdf" ? (
          <BlobFrame src={inline} type="application/pdf" />
        ) : kind === "text" ? (
          <TextView src={inline} />
        ) : kind === "docx" ? (
          <DocxView src={raw} />
        ) : kind === "sheet" ? (
          <SheetView src={raw} />
        ) : kind === "link" && embed && !mediaDetails ? (
          <iframe
            src={embed}
            title={file.name}
            className="h-[70dvh] w-full"
            allow="autoplay"
          />
        ) : (
          <NoPreview />
        )}
      </div> : null}

      <div className="flex flex-wrap justify-end gap-2">
        {kind === "image" && !showImage ? (
          <button type="button" onClick={() => setShowImage(true)} className="hs-btn hs-btn-secondary">Preview</button>
        ) : null}
        {external ? (
          <a href={external} target="_blank" rel="noreferrer noopener" className="hs-btn hs-btn-secondary">
            Open online ↗
          </a>
        ) : (
          <>
            {kind === "image" || kind === "video" || kind === "audio" || kind === "pdf" || kind === "text" ? (
              <a href={inline} target="_blank" rel="noopener" className="hs-btn hs-btn-secondary">
                Open online ↗
              </a>
            ) : null}
            <a href={raw} className="hs-btn hs-btn-primary">
              Download
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function NoPreview() {
  return (
    <p className="p-8 text-center text-sm text-muted">
      This type of file cannot be previewed in the browser. Download it to open it.
    </p>
  );
}

function useBytes(src: string) {
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(src)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => live && setData(b))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [src]);
  return { data, error };
}

const Loading = () => <p className="p-8 text-sm text-faint">Loading preview…</p>;
const Failed = () => <p className="p-8 text-sm text-danger-strong">Could not load this file.</p>;

/** PDFs are fetched into a blob and framed from there, so the file's own strict headers stay intact. */
function BlobFrame({ src, type }: { src: string; type: string }) {
  const { data, error } = useBytes(src);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const u = URL.createObjectURL(new Blob([data], { type }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data, type]);
  if (error) return <Failed />;
  if (!url) return <Loading />;
  return <iframe src={url} title="PDF preview" className="h-[70dvh] w-full bg-white" />;
}

function TextView({ src }: { src: string }) {
  const { data, error } = useBytes(src);
  if (error) return <Failed />;
  if (!data) return <Loading />;
  const text = new TextDecoder().decode(data.slice(0, 2_000_000));
  return (
    <pre className="max-h-[70dvh] w-full overflow-auto whitespace-pre-wrap p-4 text-left text-xs text-ink">
      {text}
    </pre>
  );
}

function DocxView({ src }: { src: string }) {
  const { data, error } = useBytes(src);
  const box = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!data || !box.current) return;
    const el = box.current;
    import("docx-preview")
      .then((m) => m.renderAsync(data, el, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true }))
      .catch(() => setFailed(true));
  }, [data]);
  if (error || failed) return <Failed />;
  return (
    <div className="max-h-[70dvh] w-full overflow-auto bg-white text-left">
      {!data ? <Loading /> : null}
      <div ref={box} />
    </div>
  );
}

function SheetView({ src }: { src: string }) {
  const { data, error } = useBytes(src);
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!data) return;
    import("read-excel-file")
      .then((m) => m.default(new Blob([data])))
      .then((r) => setRows(r as unknown[][]))
      .catch(() => setFailed(true));
  }, [data]);
  if (error || failed) return <Failed />;
  if (!rows) return <Loading />;
  const shown = rows.slice(0, 500);
  return (
    <div className="max-h-[70dvh] w-full overflow-auto bg-surface">
      <table className="min-w-full border-collapse text-left text-xs">
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className={i === 0 ? "bg-tint font-semibold" : ""}>
              {r.map((c, j) => (
                <td key={j} className="whitespace-nowrap border border-line px-2 py-1">
                  {c == null ? "" : c instanceof Date ? c.toLocaleDateString("en-GB") : String(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 500 ? (
        <p className="p-2 text-xs text-faint">Showing the first 500 rows. Download for the rest.</p>
      ) : null}
    </div>
  );
}
