"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { ColorForm, RampForm } from "@/components/brand-forms";
import { AttachmentUploader } from "@/components/attachments";
import { Feedback, SubmitButton } from "@/components/form-bits";
import { CopyButton } from "@/components/chrome";
import { deleteBrandToken, updateBrandColor } from "@/lib/actions/brand";
import { deleteAttachment } from "@/lib/actions/attachments";
import { formatBytes } from "@/lib/attachments";
import type { FormState } from "@/lib/actions/auth";

export type KitColor = {
  id: string;
  name: string;
  value: string;
  groupName: string | null;
  note: string | null;
};

export type KitFile = { id: string; name: string; size: number; mimeType: string };

const fileUrl = (id: string) => `/api/attachments/${id}`;

/** Saves a Blob as a file, without leaving the page. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetches every file and zips it in the browser. */
async function downloadZip(files: KitFile[], zipName: string) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    const res = await fetch(fileUrl(f.id));
    if (!res.ok) continue;
    let name = f.name;
    for (let n = 2; used.has(name); n += 1) name = f.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    used.add(name);
    zip.file(name, await res.arrayBuffer());
  }
  saveBlob(await zip.generateAsync({ type: "blob" }), zipName);
}

function ZipButton({ files, zipName }: { files: KitFile[]; zipName: string }) {
  const [busy, setBusy] = useState(false);
  if (files.length === 0) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadZip(files, zipName);
        } finally {
          setBusy(false);
        }
      }}
      className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs"
    >
      {busy ? "Zipping…" : `Download all (.zip)`}
    </button>
  );
}

function PlusButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-lg font-bold leading-none text-white shadow hover:opacity-90"
    >
      +
    </button>
  );
}

function SectionHead({ title, count, children }: { title: string; count?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="hs-h2">
        {title}
        {count ? <span className="ml-2 text-sm font-normal text-faint">{count}</span> : null}
      </h2>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function RemoveFile({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hs-btn hs-btn-ghost px-2 py-1 text-[11px] text-danger-strong">
        Remove
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Remove ${name}?`} description="It is taken out of the brand kit for everyone.">
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="hs-btn hs-btn-ghost">Cancel</button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await deleteAttachment(id);
                setOpen(false);
                router.refresh();
              })
            }
            className="hs-btn hs-btn-primary"
          >
            {pending ? "Removing…" : "Remove"}
          </button>
        </div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Core palette
// ---------------------------------------------------------------------------

export function PaletteSection({ colors, canEdit }: { colors: KitColor[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"one" | "scheme">("one");
  const [editing, setEditing] = useState<KitColor | null>(null);

  const groups = new Map<string, KitColor[]>();
  for (const c of colors) {
    const k = c.groupName ?? "Other";
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }

  return (
    <div className="hs-card p-5">
      <SectionHead title="Core palette" count={`${colors.length} colours`}>
        <a href="/brand/export" className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">Export PDF</a>
        <button type="button" onClick={() => exportPalettePng(colors)} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
          Export PNG
        </button>
        {canEdit ? <PlusButton onClick={() => setAdding(true)} label="Add a colour" /> : null}
      </SectionHead>

      {canEdit ? <p className="-mt-2 mb-4 text-xs text-faint">Click a colour to change or remove it.</p> : null}

      {colors.length === 0 ? (
        <p className="text-sm text-faint">No colours yet.</p>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([group, list]) => (
            <div key={group}>
              {groups.size > 1 ? <h3 className="hs-eyebrow mb-2">{group}</h3> : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {list.map((c) => (
                  <div key={c.id} className="rounded-xl border border-line p-3">
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setEditing(c)}
                      className="mb-2 block h-16 w-full rounded-lg border border-line enabled:hover:scale-[1.02] enabled:cursor-pointer transition"
                      style={{ background: c.value }}
                      aria-label={canEdit ? `Edit ${c.name}` : c.name}
                    />
                    <p className="truncate text-sm font-bold text-ink">{c.name}</p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-xs text-brand-deep">{c.value}</p>
                      <CopyButton value={c.value} label="Copy" className="hs-btn hs-btn-ghost px-2 py-0.5 text-[11px]" />
                    </div>
                    {c.note ? <p className="mt-0.5 truncate text-[11px] text-faint">{c.note}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add to the palette" size="lg">
        <div className="mb-4 flex gap-1 rounded-full bg-tint p-1 text-sm font-semibold">
          {(["one", "scheme"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full px-3 py-1.5 ${tab === t ? "bg-surface text-brand-deep shadow" : "text-muted"}`}
            >
              {t === "one" ? "Add a colour" : "Generate a scheme"}
            </button>
          ))}
        </div>
        {tab === "one" ? <ColorForm /> : <RampForm />}
      </Modal>

      {editing ? <EditColor color={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function EditColor({ color, onClose }: { color: KitColor; onClose: () => void }) {
  const router = useRouter();
  const [state, action] = useActionState<FormState, FormData>(updateBrandColor, {});
  const [value, setValue] = useState(color.value);
  const [removing, start] = useTransition();

  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);

  return (
    <Modal open onClose={onClose} title={`Edit ${color.name}`} size="lg">
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={color.id} />
        <div className="h-20 rounded-xl border border-line" style={{ background: /^#[0-9a-f]{6}$/i.test(value) ? value : color.value }} />
        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <input
            type="color"
            aria-label="Pick colour"
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            className="h-11 w-16 cursor-pointer rounded-lg border border-line"
          />
          <input name="value" value={value} onChange={(e) => setValue(e.target.value)} className="hs-input font-mono" aria-label="Hex" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="hs-label" htmlFor="ec-name">Name</label>
            <input id="ec-name" name="name" defaultValue={color.name} required maxLength={60} className="hs-input" />
          </div>
          <div>
            <label className="hs-label" htmlFor="ec-group">Group</label>
            <input id="ec-group" name="groupName" defaultValue={color.groupName ?? ""} maxLength={60} className="hs-input" />
          </div>
        </div>
        <div>
          <label className="hs-label" htmlFor="ec-note">Used for</label>
          <input id="ec-note" name="note" defaultValue={color.note ?? ""} maxLength={200} className="hs-input" />
        </div>
        <Feedback state={state} />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={removing}
            onClick={() =>
              start(async () => {
                await deleteBrandToken(color.id);
                onClose();
                router.refresh();
              })
            }
            className="hs-btn hs-btn-ghost text-danger-strong"
          >
            {removing ? "Removing…" : "Remove colour"}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="hs-btn hs-btn-ghost">Cancel</button>
            <SubmitButton>Save</SubmitButton>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Draws the palette onto a canvas and saves it as a PNG. */
function exportPalettePng(colors: KitColor[]) {
  const cols = 4;
  const w = 260;
  const h = 200;
  const pad = 32;
  const head = 110;
  const rows = Math.max(1, Math.ceil(colors.length / cols));
  const canvas = document.createElement("canvas");
  canvas.width = pad * 2 + cols * w;
  canvas.height = head + rows * h + pad;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#BE185D";
  ctx.font = "bold 36px Inter, Arial, sans-serif";
  ctx.fillText("KMIDS Hackathon 2027 · Core palette", pad, 64);
  ctx.fillStyle = "#64748B";
  ctx.font = "16px Inter, Arial, sans-serif";
  ctx.fillText(`${colors.length} colours`, pad, 92);

  colors.forEach((c, i) => {
    const x = pad + (i % cols) * w;
    const y = head + Math.floor(i / cols) * h;
    ctx.fillStyle = c.value;
    ctx.beginPath();
    ctx.roundRect(x, y, w - 20, 110, 14);
    ctx.fill();
    ctx.strokeStyle = "#E5E7EB";
    ctx.stroke();
    ctx.fillStyle = "#1F2937";
    ctx.font = "bold 17px Inter, Arial, sans-serif";
    ctx.fillText(c.name.slice(0, 26), x, y + 136);
    ctx.fillStyle = "#BE185D";
    ctx.font = "15px ui-monospace, Menlo, monospace";
    ctx.fillText(c.value, x, y + 158);
    if (c.note) {
      ctx.fillStyle = "#94A3B8";
      ctx.font = "12px Inter, Arial, sans-serif";
      ctx.fillText(c.note.slice(0, 36), x, y + 176);
    }
  });

  canvas.toBlob((blob) => blob && saveBlob(blob, "brand-core-palette.png"), "image/png");
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

const LEVELS = [
  { label: "Display", size: 40, weight: 800 },
  { label: "Heading 1", size: 30, weight: 700 },
  { label: "Heading 2", size: 22, weight: 700 },
  { label: "Subheading", size: 17, weight: 600 },
  { label: "Body", size: 15, weight: 400 },
  { label: "Caption", size: 12, weight: 500 },
];

const fontTitle = (name: string) => name.replace(/\.(ttf|otf|woff2?|zip)$/i, "").replace(/[-_]+/g, " ");

/** Loads an uploaded font file into the page under its own family name. */
function useFontFace(file: KitFile) {
  const family = `brandfont-${file.id}`;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let live = true;
    fetch(fileUrl(file.id))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((buf) => new FontFace(family, buf).load())
      .then((face) => {
        document.fonts.add(face);
        if (live) setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [file.id, family]);
  return { family, state };
}

export function FontsSection({ fonts, canEdit, maxBytes }: { fonts: KitFile[]; canEdit: boolean; maxBytes: number }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("KMIDS Hackathon 2027");

  return (
    <div className="hs-card p-5">
      <SectionHead title="Typography" count={`${fonts.length} ${fonts.length === 1 ? "font" : "fonts"}`}>
        <ZipButton files={fonts} zipName="brand-fonts.zip" />
        {canEdit ? <PlusButton onClick={() => setAdding(true)} label="Upload a font" /> : null}
      </SectionHead>

      <label className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-tint/40 px-3 py-2">
        <span aria-hidden="true" title="Type to preview">✏️</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type anything to preview it in every font…"
          aria-label="Preview text"
          className="w-full bg-transparent text-sm text-ink outline-none"
        />
      </label>

      {fonts.length === 0 ? (
        <p className="text-sm text-faint">
          No fonts yet.{canEdit ? " Press + to upload .ttf, .otf, .woff or .woff2 files." : ""}
        </p>
      ) : (
        <div className="space-y-4">
          {fonts.map((f) => (
            <FontCard key={f.id} file={f} text={text || "KMIDS Hackathon 2027"} canEdit={canEdit} />
          ))}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Upload fonts" description=".ttf, .otf, .woff or .woff2. You can pick several at once." size="lg">
        <AttachmentUploader
          parentType="brand_font"
          parentId="kit"
          maxBytes={maxBytes}
          accept=".ttf,.otf,.woff,.woff2"
          onUploaded={() => setAdding(false)}
        />
      </Modal>
    </div>
  );
}

function FontCard({ file, text, canEdit }: { file: KitFile; text: string; canEdit: boolean }) {
  const { family, state } = useFontFace(file);
  const stack = `"${family}", system-ui, sans-serif`;

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold text-ink" style={{ fontFamily: stack }}>{fontTitle(file.name)}</p>
          <p className="truncate font-mono text-[11px] text-faint">
            {file.name} · {formatBytes(file.size)}
            {state === "loading" ? " · loading…" : state === "error" ? " · could not load this file" : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <a href={fileUrl(file.id)} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">Download</a>
          {canEdit ? <RemoveFile id={file.id} name={fontTitle(file.name)} /> : null}
        </div>
      </div>

      <div className="divide-y divide-line">
        {LEVELS.map((l) => (
          <div key={l.label} className="flex items-baseline gap-3 py-2">
            <span className="w-24 shrink-0 text-[10px] font-bold uppercase tracking-wide text-faint">{l.label}</span>
            <span
              className="min-w-0 flex-1 break-words text-ink"
              style={{ fontFamily: stack, fontSize: l.size, fontWeight: l.weight, lineHeight: 1.2 }}
            >
              {text}
            </span>
            <span className="hidden shrink-0 font-mono text-[10px] text-faint sm:inline">
              {l.size}px · {l.weight}
            </span>
          </div>
        ))}
        <p className="pt-2 text-sm text-muted" style={{ fontFamily: stack }}>
          ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !@#&?
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------

export function LogosSection({ logos, canEdit, maxBytes }: { logos: KitFile[]; canEdit: boolean; maxBytes: number }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="hs-card p-5">
      <SectionHead title="Logos" count={`${logos.length}`}>
        <ZipButton files={logos} zipName="brand-logos.zip" />
        {canEdit ? <PlusButton onClick={() => setAdding(true)} label="Upload a logo" /> : null}
      </SectionHead>

      {logos.length === 0 ? (
        <p className="text-sm text-faint">No logos yet.{canEdit ? " Press + to upload PNG files." : ""}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {logos.map((l) => (
            <div key={l.id} className="overflow-hidden rounded-xl border border-line">
              <div className="grid grid-cols-2">
                <div className="flex h-36 items-center justify-center bg-white p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${fileUrl(l.id)}?inline=1`} alt={`${l.name} on light`} className="max-h-full max-w-full object-contain" />
                </div>
                <div className="flex h-36 items-center justify-center bg-[#17121A] p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${fileUrl(l.id)}?inline=1`} alt={`${l.name} on dark`} className="max-h-full max-w-full object-contain" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-line p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
                  <p className="text-[11px] text-faint">Light · Dark · {formatBytes(l.size)}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <a href={fileUrl(l.id)} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">Download</a>
                  {canEdit ? <RemoveFile id={l.id} name={l.name} /> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Upload logos" description="PNG works best. JPG and WEBP also work." size="lg">
        <AttachmentUploader
          parentType="brand_logo"
          parentId="kit"
          maxBytes={maxBytes}
          accept=".png,.jpg,.jpeg,.webp"
          onUploaded={() => setAdding(false)}
        />
      </Modal>
    </div>
  );
}
