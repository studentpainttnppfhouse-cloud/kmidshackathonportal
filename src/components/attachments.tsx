"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteAttachment,
  linkAttachment,
  uploadAttachments,
  type UploadState,
} from "@/lib/actions/attachments";
import { Feedback, SubmitButton } from "@/components/form-bits";
import {
  KIND_ICON,
  MAX_FILES_PER_UPLOAD,
  formatBytes,
  kindOf,
} from "@/lib/attachments";
import type { FormState } from "@/lib/actions/auth";
import { FilePreviewButton } from "@/components/file-preview";

const initialUpload: UploadState = {};
const initialLink: FormState = {};

export type AttachmentItem = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storage: string;
  externalUrl: string | null;
  createdAt: Date;
  uploadedBy: { id: string; name: string; nickname: string | null };
};

/**
 * Files on a task, a document, an announcement — anywhere they belong.
 *
 * Picking a file uploads it. There is no second button to press and no
 * surrounding form to remember to save, because the failure this replaces is
 * somebody attaching their poster, closing the tab, and finding out on the
 * morning of the event that it never existed. A file chosen here is a row in
 * the database before the file dialog has finished closing.
 *
 * A visible upload button stays anyway. Auto-submit needs JavaScript; the
 * button is what makes the panel work without it.
 */
export function Attachments({
  parentType,
  parentId,
  canWrite,
  attachments,
  viewerId,
  maxBytes,
  title = "Files",
  hint,
}: {
  parentType: string;
  parentId: string;
  canWrite: boolean;
  attachments: AttachmentItem[];
  viewerId: string;
  /**
   * The server's own limit, handed down rather than imported.
   *
   * `MAX_UPLOAD_MB` is a plain environment variable, so the browser bundle
   * cannot read it — importing the limit here would silently give the client
   * the default while the server enforced something else. Passing it keeps one
   * number in one place.
   */
  maxBytes: number;
  title?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="hs-h2">
          {title}
          {attachments.length > 0 ? (
            <span className="ml-2 text-sm font-normal text-faint">{attachments.length}</span>
          ) : null}
        </h2>
        {hint ? <p className="text-xs text-faint">{hint}</p> : null}
      </div>

      <AttachmentList
        attachments={attachments}
        canWrite={canWrite}
        viewerId={viewerId}
      />

      {canWrite ? (
        <AttachmentUploader parentType={parentType} parentId={parentId} maxBytes={maxBytes} />
      ) : null}
    </div>
  );
}

export function AttachmentList({
  attachments,
  canWrite,
  viewerId,
}: {
  attachments: AttachmentItem[];
  canWrite: boolean;
  viewerId: string;
}) {
  if (attachments.length === 0) {
    return <p className="text-sm text-faint">Nothing attached yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {attachments.map((file) => (
        <AttachmentRow
          key={file.id}
          file={file}
          canRemove={canWrite || file.uploadedBy.id === viewerId}
        />
      ))}
    </ul>
  );
}

function AttachmentRow({ file, canRemove }: { file: AttachmentItem; canRemove: boolean }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const linked = file.storage === "link";
  const href = `/api/attachments/${file.id}`;

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
      <span aria-hidden="true" className="text-lg">
        {linked ? "🔗" : KIND_ICON[kindOf(file.mimeType)]}
      </span>

      <div className="min-w-0 flex-1">
        <FilePreviewButton
          file={file}
          className="block max-w-full truncate text-left text-sm font-semibold text-ink hover:text-brand-deep"
        >
          {file.name}
          {linked ? " ↗" : ""}
        </FilePreviewButton>
        <p className="truncate text-xs text-faint">
          {linked ? "Stored elsewhere" : formatBytes(file.size)} ·{" "}
          {file.uploadedBy.nickname || file.uploadedBy.name}
        </p>
      </div>

      {canRemove ? (
        <button
          type="button"
          disabled={removing}
          onClick={async () => {
            setRemoving(true);
            await deleteAttachment(file.id);
            router.refresh();
          }}
          className="hs-btn hs-btn-ghost px-3 py-1.5 text-xs"
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      ) : null}
    </li>
  );
}

/**
 * The upload box.
 *
 * The over-the-limit case gets its own panel rather than a bare error, because
 * "that file is too big" without somewhere to put it is a dead end. The size
 * is checked in the browser first only so the person is told before they wait
 * for the upload; the server checks it again, and the server is the one that
 * decides.
 */
function AttachmentUploader({
  parentType,
  parentId,
  maxBytes,
}: {
  parentType: string;
  parentId: string;
  maxBytes: number;
}) {
  const router = useRouter();
  const [state, action] = useActionState(uploadAttachments, initialUpload);
  const formRef = useRef<HTMLFormElement>(null);
  const [oversize, setOversize] = useState<{ name: string; size: number } | null>(null);

  useEffect(() => {
    if (state.uploaded) {
      formRef.current?.reset();
      // The list is server-rendered, so a successful upload needs the page
      // data again — revalidatePath alone does not repaint a client component.
      router.refresh();
    }
  }, [state.uploaded, router]);

  return (
    <div className="space-y-3">
      <form ref={formRef} action={action} className="space-y-2">
        <input type="hidden" name="parentType" value={parentType} />
        <input type="hidden" name="parentId" value={parentId} />

        <label className="hs-label" htmlFor={`att-${parentId}`}>
          Attach a file
        </label>
        <input
          id={`att-${parentId}`}
          name="files"
          type="file"
          multiple
          className="hs-input file:mr-3 file:rounded-lg file:border-0 file:bg-tint file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-deep"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            const big = files.find((file) => file.size > maxBytes);

            if (big) {
              // Stop before the upload rather than after: on a phone this
              // saves a minute of watching a spinner fail.
              setOversize({ name: big.name, size: big.size });
              event.target.value = "";
              return;
            }

            setOversize(null);
            if (files.length > 0) formRef.current?.requestSubmit();
          }}
        />

        <p className="text-xs text-faint">
          Up to {MAX_FILES_PER_UPLOAD} files, {formatBytes(maxBytes)} each. They save straight into the
          portal — every device that signs in sees them, and a redeploy does not touch them.
        </p>

        <Feedback state={state} />

        {/* Auto-submit covers the ordinary case; this covers no-JavaScript. */}
        <SubmitButton className="hs-btn hs-btn-secondary" pendingLabel="Saving…">
          Upload
        </SubmitButton>
      </form>

      {oversize ? (
        <OversizePanel
          parentType={parentType}
          parentId={parentId}
          file={oversize}
          maxBytes={maxBytes}
          onDone={() => {
            setOversize(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * What happens when a file will not fit.
 *
 * The portal keeps the name and the link, so the task still says the file
 * exists and where it is. That is the old link-only design, kept for exactly
 * the case it was right about.
 */
function OversizePanel({
  parentType,
  parentId,
  file,
  maxBytes,
  onDone,
}: {
  parentType: string;
  parentId: string;
  file: { name: string; size: number };
  maxBytes: number;
  onDone: () => void;
}) {
  const [state, action] = useActionState(linkAttachment, initialLink);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <div className="rounded-xl border border-warn-edge bg-warn-soft p-3">
      <p className="text-sm font-bold text-ink">
        {file.name} is {formatBytes(file.size)}
      </p>
      <p className="mt-1 text-xs text-muted">
        Over the {formatBytes(maxBytes)} limit, so the bytes stay where they are. Put it in Drive and
        paste the link — the file still shows up here, with its name and who added it.
      </p>

      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="parentType" value={parentType} />
        <input type="hidden" name="parentId" value={parentId} />

        <label className="sr-only" htmlFor={`att-link-name-${parentId}`}>
          File name
        </label>
        <input
          id={`att-link-name-${parentId}`}
          name="name"
          required
          maxLength={200}
          defaultValue={file.name}
          className="hs-input py-1.5 text-sm"
        />

        <label className="sr-only" htmlFor={`att-link-url-${parentId}`}>
          Link to the file
        </label>
        <input
          id={`att-link-url-${parentId}`}
          name="externalUrl"
          type="url"
          required
          placeholder="https://drive.google.com/…"
          className="hs-input py-1.5 text-sm"
        />

        <Feedback state={state} />

        <div className="flex flex-wrap gap-2">
          <SubmitButton className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs" pendingLabel="Adding…">
            Add it as a link
          </SubmitButton>
          <button
            type="button"
            onClick={onDone}
            className="hs-btn hs-btn-ghost px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
