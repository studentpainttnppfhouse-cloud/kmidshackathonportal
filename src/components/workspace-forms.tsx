"use client";
import { useActionState, useState } from "react";
import {
  saveEntry,
  saveDrive,
  submitDrive,
  listDriveChoices,
} from "@/lib/actions/workspace";
import { Feedback, SubmitButton } from "./form-bits";
import { renderMarkdown } from "@/lib/markdown";
import type { FormState } from "@/lib/actions/auth";
type Choice = { id: string; name: string };
export function EntryForm({
  entry,
  people,
  departments,
  level,
  ownDepartment,
}: {
  entry?: {
    id?: string;
    title?: string;
    body?: string | null;
    date?: string;
    time?: string;
    end?: string;
    scope?: string;
    kind?: string;
    departmentId?: string | null;
    attendeeIds?: string[];
    location?: string | null;
    allDay?: boolean;
    summary?: string | null;
    nextSteps?: string | null;
  };
  people: Choice[];
  departments: Choice[];
  level: number;
  ownDepartment: string | null;
}) {
  const [state, action] = useActionState(saveEntry, {} as FormState);
  return (
    <form action={action} className="hs-card space-y-4 p-5">
      <input type="hidden" name="id" value={entry?.id ?? ""} />
      <label className="hs-label">
        Title
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={entry?.title}
          className="hs-input"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="hs-label">
          Date
          <input
            type="date"
            required
            name="date"
            defaultValue={entry?.date}
            className="hs-input"
          />
        </label>
        <label className="hs-label">
          Start (Bangkok)
          <input
            type="time"
            required
            name="time"
            defaultValue={entry?.time ?? "09:00"}
            className="hs-input"
          />
        </label>
        <label className="hs-label">
          End (optional)
          <input
            type="datetime-local"
            name="end"
            defaultValue={entry?.end}
            className="hs-input"
          />
        </label>
      </div>
      <label className="hs-label">
        Type
        <select
          name="kind"
          defaultValue={entry?.kind ?? "event"}
          className="hs-input"
        >
          <option value="event">Event</option>
          <option value="meeting">Meeting</option>
          <option value="post">Instagram post</option>
        </select>
      </label>
      <label className="hs-label">
        Visibility
        <select
          name="scope"
          defaultValue={entry?.scope ?? "private"}
          className="hs-input"
        >
          <option value="private">Only me</option>
          {level >= 2 ? (
            <>
              <option value="people">Selected people</option>
              <option value="department">Team</option>
            </>
          ) : null}
          {level >= 3 ? <option value="all">Everyone</option> : null}
        </select>
      </label>
      {level >= 2 ? (
        <>
          <label className="hs-label">
            Team
            <select
              name="departmentId"
              defaultValue={entry?.departmentId ?? ownDepartment ?? ""}
              className="hs-input"
            >
              <option value="">No team</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="hs-label">Assign attendees</legend>
            <div className="grid max-h-44 gap-2 overflow-auto sm:grid-cols-2">
              {people.map((p) => (
                <label key={p.id} className="text-sm">
                  <input
                    type="checkbox"
                    name="attendeeIds"
                    value={p.id}
                    defaultChecked={entry?.attendeeIds?.includes(p.id)}
                  />{" "}
                  {p.name}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ) : null}
      <label className="text-sm">
        <input type="checkbox" name="allDay" defaultChecked={entry?.allDay} />{" "}
        All day / time to be confirmed
      </label>
      <label className="hs-label">
        Location
        <input
          name="location"
          maxLength={200}
          defaultValue={entry?.location ?? ""}
          className="hs-input"
        />
      </label>
      <label className="hs-label">
        Agenda / notes
        <textarea
          name="body"
          rows={6}
          maxLength={20000}
          defaultValue={entry?.body ?? ""}
          className="hs-input"
        />
      </label>
      <label className="hs-label">
        Meeting summary
        <textarea
          name="summary"
          rows={3}
          maxLength={5000}
          defaultValue={entry?.summary ?? ""}
          className="hs-input"
        />
      </label>
      <label className="hs-label">
        Next steps
        <textarea
          name="nextSteps"
          rows={3}
          maxLength={5000}
          defaultValue={entry?.nextSteps ?? ""}
          className="hs-input"
        />
      </label>
      <Feedback state={state} />
      <SubmitButton className="hs-btn hs-btn-primary">Save event</SubmitButton>
    </form>
  );
}
export function DriveForm({
  item,
  people,
  departments,
}: {
  item?: {
    id: string;
    title: string;
    body: string | null;
    scope: string;
    kind: string;
    departmentId: string | null;
    sharedUserIds: string[];
  };
  people: Choice[];
  departments: Choice[];
}) {
  const [state, action] = useActionState(saveDrive, {} as FormState);
  const [body, setBody] = useState(item?.body ?? "");
  const [preview, setPreview] = useState(false);
  function insert(before: string, after = "") {
    const el = document.getElementById(
      "drive-body",
    ) as HTMLTextAreaElement | null;
    if (!el) return;
    const a = el.selectionStart,
      b = el.selectionEnd;
    setBody(
      body.slice(0, a) + before + body.slice(a, b) + after + body.slice(b),
    );
    el.focus();
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={item?.id ?? ""} />
      <input type="hidden" name="body" value={body} />
      <div className="hs-card space-y-4 p-5">
        <label className="hs-label">
          Title
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={item?.title}
            className="hs-input"
          />
        </label>
        <label className="hs-label">
          Item type
          <select
            className="hs-input"
            name="kind"
            defaultValue={item?.kind ?? "document"}
          >
            <option value="document">Document</option>
            <option value="folder">File collection</option>
          </select>
        </label>
        <div
          className="flex flex-wrap gap-2"
          role="toolbar"
          aria-label="Document formatting"
        >
          {[
            ["Bold", "**", "**"],
            ["Italic", "*", "*"],
            ["Heading", "\n## ", ""],
            ["List", "\n- ", ""],
            ["Quote", "\n> ", ""],
          ].map(([label, b, a]) => (
            <button
              className="hs-btn hs-btn-secondary"
              key={label}
              type="button"
              onClick={() => insert(b, a)}
            >
              {label}
            </button>
          ))}
          <button
            className="hs-btn hs-btn-secondary"
            type="button"
            onClick={() => setPreview(!preview)}
          >
            {preview ? "Write" : "Preview"}
          </button>
        </div>
        {preview ? (
          <article
            className="hs-prose min-h-72"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
          />
        ) : (
          <textarea
            aria-label="Document content"
            id="drive-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            maxLength={400000}
            className="hs-input resize-y leading-relaxed"
            placeholder="Write your document here. Use the toolbar for formatting."
          />
        )}
      </div>
      <details className="hs-card p-5" open>
        <summary className="font-semibold">
          Sharing — readers cannot edit your document
        </summary>
        <div className="mt-4 space-y-4">
          <label className="hs-label">
            Who can read
            <select
              name="scope"
              defaultValue={item?.scope ?? "private"}
              className="hs-input"
            >
              <option value="private">Only me</option>
              <option value="people">Selected people</option>
              <option value="department">Department</option>
              <option value="all">Everyone in the portal</option>
            </select>
          </label>
          <label className="hs-label">
            Department
            <select
              name="departmentId"
              defaultValue={item?.departmentId ?? ""}
              className="hs-input"
            >
              <option value="">Select department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="hs-label">People</legend>
            <div className="grid max-h-40 gap-2 overflow-auto sm:grid-cols-2">
              {people.map((p) => (
                <label key={p.id} className="text-sm">
                  <input
                    name="sharedUserIds"
                    type="checkbox"
                    value={p.id}
                    defaultChecked={item?.sharedUserIds.includes(p.id)}
                  />{" "}
                  {p.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
      <p className="text-sm text-muted">
        Save first, then add local files. Everything stays in the portal.
      </p>
      <Feedback state={state} />
      <SubmitButton className="hs-btn hs-btn-primary">
        Save to my drive
      </SubmitButton>
    </form>
  );
}
export function DrivePicker({ assignmentId }: { assignmentId: string }) {
  const [items, setItems] = useState<{ id: string; title: string }[] | null>(
    null,
  );
  const [state, action] = useActionState(submitDrive, {} as FormState);
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="hs-btn hs-btn-secondary"
        onClick={async () => {
          try {
            setItems(await listDriveChoices());
          } catch {
            setError("Could not open your drive. Please try again.");
          }
        }}
      >
        Attach from portal drive
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {items ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <label className="hs-label">
            My drive item
            <select required name="itemId" className="hs-input">
              <option value="">Select your document or file collection</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            Submitting grants the task owners and supervisors read access to
            this item and its files. Later edits remain visible.
          </p>
          <SubmitButton className="hs-btn hs-btn-primary">
            Attach selected item
          </SubmitButton>
          <Feedback state={state} />
        </form>
      ) : null}
    </div>
  );
}
