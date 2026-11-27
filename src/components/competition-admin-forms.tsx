"use client";

import { useActionState, useMemo, useState } from "react";
import { Feedback, SubmitButton } from "@/components/form-bits";
import {
  issueTeamLink,
  recordArchive,
  reopenSubmission,
  reviewTeam,
  saveCompetitionDefinition,
  saveCompetitionSettings,
  type AdminState,
} from "@/lib/actions/competition-admin";
import type { CQuestion, CSection, CStage, CompetitionDefinition, CompetitionSettings, Track } from "@/lib/competition/schema";

const initial: AdminState = {};

// ---------------------------------------------------------------------------
// Organizer settings
// ---------------------------------------------------------------------------

export function SettingsForm({
  formId,
  track,
  settings,
  opensAt,
  closesAt,
  isOwner,
}: {
  formId: string;
  track: Track;
  settings: CompetitionSettings;
  opensAt: string;
  closesAt: string;
  isOwner: boolean;
}) {
  const [state, action] = useActionState(saveCompetitionSettings, initial);
  const [qr, setQr] = useState(settings.paymentQr);
  const [qrError, setQrError] = useState("");

  const pickQr = (file: File | undefined) => {
    setQrError("");
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setQrError("Use a PNG, JPG or WebP image.");
    if (file.size > 1_000_000) return setQrError("Keep the QR image under 1 MB.");
    const reader = new FileReader();
    reader.onload = () => setQr(String(reader.result));
    reader.readAsDataURL(file);
  };

  const text = (name: keyof CompetitionSettings, label: string, hint?: string, type = "text") => (
    <div>
      <label htmlFor={`s-${name}`} className="hs-label">
        {label}
      </label>
      <input
        id={`s-${name}`}
        name={name}
        type={type}
        defaultValue={String(settings[name] ?? "")}
        className="hs-input"
      />
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
  const tick = (name: keyof CompetitionSettings, label: string) => (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input type="checkbox" name={name} defaultChecked={Boolean(settings[name])} className="mt-1 accent-pink-500" />
      {label}
    </label>
  );

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="formId" value={formId} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-ink">Opening and closing (Bangkok time)</legend>
        <div>
          <label htmlFor="s-opensAt" className="hs-label">
            Opens
          </label>
          <input id="s-opensAt" name="opensAt" type="datetime-local" step="1" defaultValue={opensAt} className="hs-input" />
        </div>
        <div>
          <label htmlFor="s-closesAt" className="hs-label">
            Closes (registration and Round 1)
          </label>
          <input id="s-closesAt" name="closesAt" type="datetime-local" step="1" defaultValue={closesAt} className="hs-input" />
          <p className="mt-1 text-xs text-faint">The playbook gives no time. 23:59:59 is a proposal, not a decision.</p>
        </div>
        <div className="sm:col-span-2 space-y-2">
          {tick("closeTimeConfirmed", "The closing date and time above match what is published.")}
          {track === "internal"
            ? tick("internalDeadlineConfirmed", "The internal deadline is confirmed (assumed the same as external).")
            : null}
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-ink">Published documents</legend>
        {text("rulesUrl", "Rules & Information link", "Needed before publishing. Acknowledgement D07 points at it.")}
        {text("privacyUrl", "Approved privacy notice link", "Needed before publishing.")}
        {text("promptUrl", "Round 1 prompt link")}
        {text("rubricUrl", "Rubric link")}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold text-ink">How reviewers open Round 1 folders</legend>
        <div>
          <label htmlFor="s-reviewerAccess" className="hs-label">
            Access method
          </label>
          <select id="s-reviewerAccess" name="reviewerAccess" defaultValue={settings.reviewerAccess} className="hs-input">
            <option value="">Not decided</option>
            <option value="anyone_with_link">Anyone with the link: Viewer</option>
            <option value="reviewer_account">Share with a reviewer account</option>
          </select>
        </div>
        {text("reviewerEmail", "Reviewer account email", "Only if teams share with a reviewer account.", "email")}
      </fieldset>

      {track === "external" ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold text-ink">Payment (shown in Part E)</legend>
          {text("payeeName", "Payee name")}
          {text("bankName", "Bank")}
          {text("accountNumber", "Account number")}
          {text("promptPayId", "PromptPay ID")}
          {text("expectedFee", "Fee in THB")}
          <div>
            <p className="hs-label">Payment QR image</p>
            <input type="hidden" name="paymentQr" value={qr} />
            <input type="hidden" name="paymentQrClear" value={qr ? "" : "1"} />
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="Payment QR" className="mb-2 h-32 w-32 rounded border border-line bg-white object-contain" />
            ) : null}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickQr(e.target.files?.[0])} />
            {qr ? (
              <button type="button" onClick={() => setQr("")} className="ml-2 text-xs text-danger-strong">
                Remove
              </button>
            ) : null}
            {qrError ? <p className="mt-1 text-xs text-danger-strong">{qrError}</p> : null}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="s-refundPolicy" className="hs-label">
              Refund and withdrawal policy
            </label>
            <textarea
              id="s-refundPolicy"
              name="refundPolicy"
              rows={3}
              defaultValue={settings.refundPolicy}
              className="hs-input"
            />
            <p className="mt-1 text-xs text-faint">Still unresolved in the playbook. Do not publish a guess.</p>
          </div>
          {text("capacity", "Entry cap", "The playbook says 150. Confirm whether it counts external teams only.")}
          <div>
            <label htmlFor="s-capacityNote" className="hs-label">
              How the cap is counted
            </label>
            <input id="s-capacityNote" name="capacityNote" defaultValue={settings.capacityNote} className="hs-input" />
          </div>
          <div className="sm:col-span-2">{tick("capacityDecided", "The cap and how it is counted are decided.")}</div>
        </fieldset>
      ) : null}

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-sm font-bold text-ink">Needed later (not for Round 1)</legend>
        <div>
          <label htmlFor="s-guardianConsentText" className="hs-label">
            Approved guardian consent text (before stage H)
          </label>
          <textarea
            id="s-guardianConsentText"
            name="guardianConsentText"
            rows={2}
            defaultValue={settings.guardianConsentText}
            className="hs-input"
          />
        </div>
        {text("finalPromptNote", "Final prompt and stage AI rules")}
        {text("aiRulesNote", "Notes on assistance and AI rules")}
      </fieldset>

      {isOwner ? (
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-ink">Owner only</legend>
          {tick("publishDelegatedToAdmins", "Let admins publish and take down this form.")}
        </fieldset>
      ) : (
        <input type="hidden" name="publishDelegatedToAdmins" value={settings.publishDelegatedToAdmins ? "on" : ""} />
      )}

      <Feedback state={state} />
      <SubmitButton className="hs-btn hs-btn-primary" pendingLabel="Saving…">
        Save settings
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Reviewing one team
// ---------------------------------------------------------------------------

export function ReviewForm({
  team,
  canChooseFinalists,
}: {
  team: {
    id: string;
    track: string;
    paymentStatus: string;
    registrationStatus: string;
    accessChecked: boolean;
    finalist: boolean;
    staffNotes: string | null;
  };
  canChooseFinalists: boolean;
}) {
  const [state, action] = useActionState(reviewTeam, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="teamId" value={team.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="r-registration" className="hs-label">
            Registration
          </label>
          <select id="r-registration" name="registrationStatus" defaultValue={team.registrationStatus} className="hs-input">
            <option value="registered">Registered</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
        {team.track === "external" ? (
          <div>
            <label htmlFor="r-payment" className="hs-label">
              Payment
            </label>
            <select id="r-payment" name="paymentStatus" defaultValue={team.paymentStatus} className="hs-input">
              <option value="pending">Not checked yet</option>
              <option value="verified">Verified</option>
              <option value="flagged">Problem, follow up</option>
            </select>
          </div>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="accessChecked" defaultChecked={team.accessChecked} className="accent-pink-500" />
        Round 1 folder access checked
      </label>
      <label className={`flex items-center gap-2 text-sm ${canChooseFinalists ? "text-ink" : "text-faint"}`}>
        <input
          type="checkbox"
          name="finalist"
          defaultChecked={team.finalist}
          disabled={!canChooseFinalists}
          className="accent-pink-500"
        />
        Selected finalist {canChooseFinalists ? "" : "(admins and the owner)"}
      </label>
      {!canChooseFinalists && team.finalist ? <input type="hidden" name="finalist" value="on" /> : null}
      <div>
        <label htmlFor="r-notes" className="hs-label">
          Staff notes (never shown to the team)
        </label>
        <textarea id="r-notes" name="staffNotes" rows={3} defaultValue={team.staffNotes ?? ""} className="hs-input" />
      </div>
      <Feedback state={state} />
      <SubmitButton className="hs-btn hs-btn-primary" pendingLabel="Saving…">
        Save review
      </SubmitButton>
    </form>
  );
}

export function ArchiveForm({ submissionId }: { submissionId: string }) {
  const [state, action] = useActionState(recordArchive, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="submissionId" value={submissionId} />
      <label htmlFor={`a-${submissionId}`} className="hs-label">
        Organizer copy made. Where is it kept?
      </label>
      <input id={`a-${submissionId}`} name="archiveNote" className="hs-input" placeholder="Organizer Drive › Round 1 › internal01" />
      <Feedback state={state} />
      <SubmitButton className="hs-btn hs-btn-secondary" pendingLabel="Saving…">
        Record archive
      </SubmitButton>
    </form>
  );
}

export function ReopenForm({ submissionId }: { submissionId: string }) {
  const [state, action] = useActionState(reopenSubmission, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="submissionId" value={submissionId} />
      <label htmlFor={`o-${submissionId}`} className="hs-label">
        Reason for reopening (logged)
      </label>
      <textarea id={`o-${submissionId}`} name="reason" rows={2} className="hs-input" />
      <Feedback state={state} />
      <SubmitButton className="hs-btn hs-btn-danger" pendingLabel="Reopening…">
        Reopen this locked entry
      </SubmitButton>
    </form>
  );
}

export function IssueLinkForm({ teamId }: { teamId: string }) {
  const [state, action] = useActionState(issueTeamLink, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="teamId" value={teamId} />
      <Feedback state={state} />
      {state.link ? (
        <p className="break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink">{state.link}</p>
      ) : null}
      <SubmitButton className="hs-btn hs-btn-secondary" pendingLabel="Making…">
        Make a new team link
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Editing the wording
// ---------------------------------------------------------------------------

type Path = (string | number)[];

function setAt<T>(root: T, path: Path, value: unknown): T {
  const copy = structuredClone(root) as unknown as Record<string | number, unknown>;
  let node = copy as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i += 1) node = node[path[i]] as Record<string | number, unknown>;
  node[path[path.length - 1]] = value;
  return copy as unknown as T;
}

/**
 * Rewording a competition form. Every label, help line, section intro and
 * receipt is a text box. Structure (ids, types, options, the member repeat,
 * stop rules) is shown but not editable here, and the server ignores it even
 * if a hand-made request sends it.
 */
export function DefinitionEditor({ formId, definition }: { formId: string; definition: CompetitionDefinition }) {
  const [state, action] = useActionState(saveCompetitionDefinition, initial);
  const [draft, setDraft] = useState(definition);
  const json = useMemo(() => JSON.stringify(draft), [draft]);
  const update = (path: Path, value: unknown) => setDraft((d) => setAt(d, path, value));

  const area = (path: Path, value: string, label: string, rows = 2) => (
    <div>
      <label className="hs-label">{label}</label>
      <textarea value={value} rows={rows} onChange={(e) => update(path, e.target.value)} className="hs-input" />
    </div>
  );

  const questionEditor = (q: CQuestion, path: Path) => (
    <div key={q.id} className="space-y-2 rounded-xl border border-line p-3">
      <p className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
        <span className="font-mono font-semibold text-brand-deep">{q.id}</span>
        <span>{q.type.replace("_", " ")}</span>
        {q.options ? <span>· {q.options.join(" / ")}</span> : null}
        {q.showIf ? <span>· shown when {q.showIf.q} is {q.showIf.equals}</span> : null}
        {q.stop ? <span>· “{q.stop.value}” stops the form</span> : null}
        {q.locked ? <span>· structure locked</span> : null}
      </p>
      <textarea
        aria-label={`Label for ${q.id}`}
        value={q.label}
        rows={2}
        onChange={(e) => update([...path, "label"], e.target.value)}
        className="hs-input"
      />
      <input
        aria-label={`Help for ${q.id}`}
        value={q.help ?? ""}
        placeholder="Help text (optional)"
        onChange={(e) => update([...path, "help"], e.target.value)}
        className="hs-input"
      />
      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {!q.locked ? (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={q.required}
              onChange={(e) => update([...path, "required"], e.target.checked)}
              className="accent-pink-500"
            />
            Required
          </label>
        ) : null}
        {q.type === "document" ? (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={q.enabled !== false}
              onChange={(e) => update([...path, "enabled"], e.target.checked)}
              className="accent-pink-500"
            />
            Ask for this document
          </label>
        ) : null}
      </div>
    </div>
  );

  const sectionEditor = (s: CSection, path: Path) => (
    <details key={s.key} className="hs-disclosure" open={false}>
      <summary>{s.title}</summary>
      <div className="space-y-3 pt-3">
        <input
          aria-label="Section title"
          value={s.title}
          onChange={(e) => update([...path, "title"], e.target.value)}
          className="hs-input font-semibold"
        />
        {area([...path, "intro"], s.intro ?? "", "Section intro")}
        {s.questions.map((q, i) => questionEditor(q, [...path, "questions", i]))}
        {s.memberQuestions?.length ? (
          <p className="text-xs font-semibold text-brand-deep">Repeated once per member ({"{n}"} is the member number)</p>
        ) : null}
        {s.memberQuestions?.map((q, i) => questionEditor(q, [...path, "memberQuestions", i]))}
        {s.after?.length ? <p className="text-xs font-semibold text-brand-deep">Once, after the members</p> : null}
        {s.after?.map((q, i) => questionEditor(q, [...path, "after", i]))}
      </div>
    </details>
  );

  const stageEditor = (stage: CStage, key: "f" | "h") => (
    <section className="space-y-3">
      <h2 className="text-base font-bold text-ink">
        Stage {stage.key}
        {stage.key === "H" ? <span className="ml-2 text-xs font-normal text-faint">private draft until the owner opens it</span> : null}
      </h2>
      <input value={stage.title} onChange={(e) => update([key, "title"], e.target.value)} className="hs-input font-semibold" />
      {area([key, "intro"], stage.intro, "Instructions (Markdown)", 10)}
      {stage.sections.map((s, i) => sectionEditor(s, [key, "sections", i]))}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="hs-label">Button</label>
          <input value={stage.submitLabel} onChange={(e) => update([key, "submitLabel"], e.target.value)} className="hs-input" />
        </div>
      </div>
      {area([key, "receipt"], stage.receipt, "Receipt ({teamId}, {BangkokTimestamp}, {submissionReference})", 3)}
    </section>
  );

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="formId" value={formId} />
      <input type="hidden" name="definition" value={json} />

      <section className="space-y-3">
        <h2 className="text-base font-bold text-ink">Registration</h2>
        <input
          aria-label="Form title"
          value={draft.title}
          onChange={(e) => update(["title"], e.target.value)}
          className="hs-input text-lg font-bold"
        />
        {area(["intro"], draft.intro, "Introduction (Markdown)", 8)}
        {draft.sections.map((s, i) => sectionEditor(s, ["sections", i]))}
        <div>
          <label className="hs-label">Button</label>
          <input value={draft.registerLabel} onChange={(e) => update(["registerLabel"], e.target.value)} className="hs-input" />
        </div>
        {area(["receipt"], draft.receipt, "Receipt ({teamId})", 3)}
      </section>

      {stageEditor(draft.f, "f")}
      {stageEditor(draft.h, "h")}

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow">
        <Feedback state={state} />
        <SubmitButton className="hs-btn hs-btn-primary" pendingLabel="Saving…">
          Save wording
        </SubmitButton>
      </div>
    </form>
  );
}
