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
import { SharingFields } from "./drive-sharing";
import type { FormState } from "@/lib/actions/auth";
type Choice = { id: string; name: string; departmentId?: string | null };
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
    teamNextSteps?: unknown;
  };
  people: Choice[];
  departments: Choice[];
  level: number;
  ownDepartment: string | null;
}) {
  const [state, action] = useActionState(saveEntry, {} as FormState);
  const [kind, setKind] = useState(entry?.kind ?? "event");
  const [team, setTeam] = useState(entry?.departmentId ?? ownDepartment ?? "");
  const [peopleQuery, setPeopleQuery] = useState("");
  const [scope, setScope] = useState(
    entry?.scope ?? (kind === "meeting" ? "all" : "private"),
  );
  const teamNotes =
    entry?.teamNextSteps &&
    typeof entry.teamNextSteps === "object" &&
    !Array.isArray(entry.teamNextSteps)
      ? (entry.teamNextSteps as Record<string, string>)
      : {};
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
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="hs-input"
        >
          <option value="event">Event</option>
          {level >= 2 ? <option value="meeting">Meeting</option> : null}
          <option value="post">Social media post</option>
        </select>
      </label>
      {kind === "meeting" ? (
        <p className="text-sm text-muted">
          Everyone on the portal can view meetings. Heads, admins and owners can
          edit the agenda and notes.
        </p>
      ) : (
        <label className="hs-label">
          Visibility
          <select
            name="scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
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
      )}
      {level >= 2 ? (
        <>
          <label className="hs-label">
            Team
            <select
              name="departmentId"
              value={team}
              onChange={(event) => setTeam(event.target.value)}
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
            <legend className="hs-label">
              {kind === "meeting" ? "Attendees" : "Assign people"}
            </legend>
            {kind !== "meeting" && scope === "private" ? (
              <p className="mb-2 text-xs text-muted">
                Choose Team or Selected people above to assign this event to
                staff.
              </p>
            ) : null}
            <input
              type="search"
              aria-label="Find an attendee"
              value={peopleQuery}
              onChange={(event) => setPeopleQuery(event.target.value)}
              placeholder="Search staff names"
              className="hs-input mb-2"
            />
            <div className="grid max-h-44 gap-2 overflow-auto sm:grid-cols-2">
              {people.map((p) => (
                <label
                  key={p.id}
                  hidden={
                    !p.name
                      .toLocaleLowerCase()
                      .includes(peopleQuery.toLocaleLowerCase()) ||
                    (kind !== "meeting" &&
                      !!team &&
                      p.departmentId !== team &&
                      !entry?.attendeeIds?.includes(p.id))
                  }
                  className="text-sm"
                >
                  <input
                    type="checkbox"
                    name="attendeeIds"
                    value={p.id}
                    defaultChecked={entry?.attendeeIds?.includes(p.id)}
                    disabled={kind !== "meeting" && scope === "private"}
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
      {kind === "meeting" ? (
        <>
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
          <details
            className="rounded-lg border border-line p-3"
            open={Object.keys(teamNotes).length > 0}
          >
            <summary className="cursor-pointer text-sm font-semibold">
              Next steps by team
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {departments.map((department) => (
                <label key={department.id} className="hs-label">
                  {department.name}
                  <textarea
                    name={`team-${department.id}`}
                    rows={2}
                    maxLength={2000}
                    defaultValue={teamNotes[department.id] ?? ""}
                    className="hs-input"
                  />
                </label>
              ))}
            </div>
          </details>
          <label className="hs-label">
            Overall next steps
            <textarea
              name="nextSteps"
              rows={3}
              maxLength={5000}
              defaultValue={entry?.nextSteps ?? ""}
              className="hs-input"
            />
          </label>
        </>
      ) : null}
      <Feedback state={state} />
      <SubmitButton className="hs-btn hs-btn-primary">
        {kind === "meeting" ? "Save meeting" : "Save event"}
      </SubmitButton>
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
    sharedDepartmentIds: string[];
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
      <details className="hs-card p-5">
        <summary className="cursor-pointer font-semibold">
          Sharing · private until you choose recipients
        </summary>
        <div className="mt-4">
          <SharingFields
            item={item}
            people={people}
            departments={departments}
          />
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
