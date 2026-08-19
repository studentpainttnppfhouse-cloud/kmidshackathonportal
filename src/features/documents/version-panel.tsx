'use client';

import { useState, useTransition } from 'react';
import { History, RotateCcw, Camera, ChevronRight } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { restoreVersionAction, snapshotDocumentAction } from './actions';

export interface DocVersion {
  id: string;
  label: string | null;
  created_at: string;
  author: string | null;
  plain_text: string;
}

/**
 * Version history with a side-by-side diff. The diff is line-level rather
 * than word-level — enough to see what moved without pulling in a diffing
 * library for a document that is mostly prose.
 */
export function VersionPanel({
  documentId,
  versions,
  currentText,
  editable,
}: {
  documentId: string;
  versions: DocVersion[];
  currentText: string;
  editable: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function snapshot() {
    const label = window.prompt('Name this version (optional)');
    if (label === null) return;
    setError(null);
    start(async () => {
      const res = await snapshotDocumentAction(documentId, label);
      if (!res.ok) setError(res.error);
    });
  }

  function restore(versionId: string) {
    if (!confirm('Restore this version? The current text is snapshotted first.')) return;
    setError(null);
    start(async () => {
      const res = await restoreVersionAction(documentId, versionId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <section className="card p-5">
      <div className="mb-3.5 flex items-center gap-2">
        <History size={16} className="text-pink" />
        <h2 className="text-[14px] font-bold">Version history</h2>
        {editable ? (
          <button type="button" onClick={snapshot} disabled={pending}
            className="btn-quiet ml-auto py-1.5 text-[12px]">
            <Camera size={13} /> Save version
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-[12px] font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {versions.length === 0 ? (
        <p className="text-[13px] text-muted-2">
          No saved versions yet. Snapshots let you roll back to a known-good draft.
        </p>
      ) : (
        <ul className="flex flex-col">
          {versions.map((v) => (
            <li key={v.id} className="border-b border-line last:border-0">
              <button
                type="button"
                onClick={() => setOpen(open === v.id ? null : v.id)}
                aria-expanded={open === v.id}
                className="flex w-full items-center gap-2 py-2.5 text-left"
              >
                <ChevronRight
                  size={14}
                  className="text-muted transition-transform"
                  style={{ transform: open === v.id ? 'rotate(90deg)' : undefined }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">
                    {v.label ?? 'Autosaved snapshot'}
                  </span>
                  <span className="text-[11.5px] text-muted-2">
                    {v.author ?? 'Unknown'} · {formatDateTime(v.created_at)}
                  </span>
                </span>
              </button>

              {open === v.id ? (
                <div className="pb-3.5">
                  <Diff before={v.plain_text} after={currentText} />
                  {editable ? (
                    <button type="button" onClick={() => restore(v.id)} disabled={pending}
                      className="btn-secondary mt-2.5 py-1.5 text-[12px]">
                      <RotateCcw size={13} /> Restore this version
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split('\n');
  const b = after.split('\n');
  const setB = new Set(b);
  const setA = new Set(a);

  return (
    <div className="grid gap-2 overflow-hidden rounded-md border border-line text-[12px] md:grid-cols-2">
      <div className="min-w-0 p-2.5">
        <div className="mono-tag mb-1.5 text-muted">THIS VERSION</div>
        {a.slice(0, 40).map((line, i) => (
          <div
            key={`a-${i}`}
            className="whitespace-pre-wrap break-words px-1"
            style={{ background: line && !setB.has(line) ? 'var(--danger-soft)' : undefined }}
          >
            {line || ' '}
          </div>
        ))}
      </div>
      <div className="min-w-0 border-t border-line p-2.5 md:border-l md:border-t-0">
        <div className="mono-tag mb-1.5 text-muted">NOW</div>
        {b.slice(0, 40).map((line, i) => (
          <div
            key={`b-${i}`}
            className="whitespace-pre-wrap break-words px-1"
            style={{
              background: line && !setA.has(line) ? 'color-mix(in srgb, var(--teal) 18%, transparent)' : undefined,
            }}
          >
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}
