'use client';

import { useState, useTransition } from 'react';
import {
  FileText, Film, Image as ImageIcon, Link2, Plus, Search, Trash2, Upload, X,
} from 'lucide-react';
import type { Department } from '@/lib/types';
import { formatBytes, formatDate } from '@/lib/format';
import { addExternalLinkAction, deleteFileAction, uploadFileAction } from './actions';

export interface LibraryFile {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  storage_path: string | null;
  external_url: string | null;
  department_id: string | null;
  tags: string[];
  is_brand_asset: boolean;
  created_at: string;
  publicUrl: string | null;
}

export function FilesClient({
  files,
  departments,
  canUpload,
  defaultDepartmentId,
}: {
  files: LibraryFile[];
  departments: Department[];
  canUpload: boolean;
  defaultDepartmentId: string | null;
}) {
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [dialog, setDialog] = useState<'upload' | 'link' | null>(null);
  const [preview, setPreview] = useState<LibraryFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const deptNames = Object.fromEntries(departments.map((d) => [d.id, d.name]));

  const filtered = files.filter((f) => {
    if (dept && f.department_id !== dept) return false;
    if (!query) return true;
    return `${f.name} ${f.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files and tags…" aria-label="Search files" className="input pl-9" />
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)}
          aria-label="Filter by department" className="input w-auto min-w-[160px]">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {canUpload ? (
          <>
            <button type="button" onClick={() => setDialog('link')} className="btn-secondary">
              <Link2 size={15} /> Add link
            </button>
            <button type="button" onClick={() => setDialog('upload')} className="btn-primary">
              <Upload size={15} /> Upload
            </button>
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-16 text-center">
          <ImageIcon size={26} className="mx-auto mb-3 text-muted" />
          <p className="text-[13px] text-muted-2">
            {files.length === 0 ? 'Nothing uploaded yet.' : 'Nothing matches those filters.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((f) => (
            <article key={f.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => setPreview(f)}
                className="block w-full"
                aria-label={`Preview ${f.name}`}
              >
                <Thumb file={f} />
              </button>
              <div className="p-3">
                <div className="truncate text-[13px] font-semibold">{f.name}</div>
                <div className="text-[11.5px] text-muted-2">
                  {f.external_url ? 'External link' : formatBytes(f.size)} · {formatDate(f.created_at)}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="mono-tag rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-muted-2">
                    {f.department_id ? deptNames[f.department_id] ?? 'General' : 'General'}
                  </span>
                  {f.tags.slice(0, 2).map((t) => (
                    <span key={t} className="mono-tag rounded-[5px] bg-surface-3 px-1.5 py-0.5 text-deep">
                      {t}
                    </span>
                  ))}
                  {canUpload ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm(`Move "${f.name}" to the recycle bin?`)) return;
                        setError(null);
                        start(async () => {
                          const res = await deleteFileAction(f.id);
                          if (!res.ok) setError(res.error);
                        });
                      }}
                      aria-label={`Delete ${f.name}`}
                      className="ml-auto text-muted hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog ? (
        <UploadDialog
          kind={dialog}
          departments={departments}
          defaultDepartmentId={defaultDepartmentId}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {preview ? <PreviewDialog file={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

function Thumb({ file }: { file: LibraryFile }) {
  const isImage = file.mime?.startsWith('image/');
  const isVideo = file.mime?.startsWith('video/');
  const isPdf = file.mime === 'application/pdf';

  if (isImage && file.publicUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={file.publicUrl} alt="" className="h-[120px] w-full object-cover" />
    );
  }

  const Icon = isVideo ? Film : isPdf ? FileText : file.external_url ? Link2 : ImageIcon;

  return (
    <div className="grid h-[120px] w-full place-items-center bg-surface-3 text-deep">
      <Icon size={26} />
    </div>
  );
}

function PreviewDialog({ file, onClose }: { file: LibraryFile; onClose: () => void }) {
  const url = file.publicUrl ?? file.external_url;

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.5)]" />
      <div role="dialog" aria-modal="true" aria-label={file.name}
        className="fixed left-1/2 top-1/2 z-[51] max-h-[88vh] w-[760px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-line bg-surface p-5 shadow-raised">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="truncate text-[16px] font-bold">{file.name}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {file.mime?.startsWith('image/') && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} className="max-h-[62vh] w-full rounded-lg object-contain" />
        ) : file.mime === 'application/pdf' && url ? (
          <iframe src={url} title={file.name} className="h-[62vh] w-full rounded-lg border border-line" />
        ) : (
          <div className="rounded-lg bg-surface-2 p-8 text-center text-[13px] text-muted-2">
            No inline preview for this type.
          </div>
        )}

        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="btn-secondary mt-4">
            Open original
          </a>
        ) : null}
      </div>
    </>
  );
}

function UploadDialog({
  kind, departments, defaultDepartmentId, onClose,
}: {
  kind: 'upload' | 'link';
  departments: Department[];
  defaultDepartmentId: string | null;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose}
        className="fixed inset-0 z-50 bg-[rgba(31,41,55,0.35)]" />
      <div role="dialog" aria-modal="true"
        aria-label={kind === 'upload' ? 'Upload a file' : 'Add an external link'}
        className="fixed left-1/2 top-1/2 z-[51] w-[480px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 animate-fadeup rounded-2xl border border-line bg-surface p-6 shadow-raised">
        <div className="mb-4 flex items-center">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">
            {kind === 'upload' ? 'Upload a file' : 'Add an external link'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <form
          className="flex flex-col gap-3.5"
          action={(fd) => {
            setError(null);
            start(async () => {
              const res = kind === 'upload'
                ? await uploadFileAction(fd)
                : await addExternalLinkAction(fd);
              if (res.ok) onClose();
              else setError(res.error);
            });
          }}
        >
          {kind === 'upload' ? (
            <div>
              <label className="label" htmlFor="file">File *</label>
              <input id="file" name="file" type="file" required className="input" />
              <p className="mt-1 text-[11.5px] text-muted">
                50 MB maximum. Anything larger should be an external link.
              </p>
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="external_url">URL *</label>
              <input id="external_url" name="external_url" type="url" required className="input"
                placeholder="https://drive.google.com/…" />
            </div>
          )}

          <div>
            <label className="label" htmlFor="name">Display name</label>
            <input id="name" name="name" maxLength={255} className="input"
              required={kind === 'link'} placeholder="Poster A2 final" />
          </div>

          <div>
            <label className="label" htmlFor="department_id">Department</label>
            <select id="department_id" name="department_id" className="input"
              defaultValue={defaultDepartmentId ?? ''}>
              <option value="">General</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="tags">Tags</label>
            <input id="tags" name="tags" className="input" placeholder="poster, print, final" />
            <p className="mt-1 text-[11.5px] text-muted">Comma separated.</p>
          </div>

          {kind === 'upload' ? (
            <label className="flex items-center gap-2 text-[13px] font-semibold">
              <input type="checkbox" name="is_brand_asset" className="h-4 w-4 accent-pink" />
              This is a brand asset
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-1 flex gap-2.5">
            <button type="submit" disabled={pending} className="btn-primary flex-1">
              {pending ? 'Saving…' : kind === 'upload' ? 'Upload' : 'Add link'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
