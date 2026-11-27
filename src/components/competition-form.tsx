"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  expandSection,
  fieldName,
  isVisible,
  memberCountFrom,
  validateQuestions,
  MAX_MEMBERS,
  type Concrete,
  type CSection,
} from "@/lib/competition/schema";
import { formatBytes } from "@/lib/attachments";
import { renderMarkdown } from "@/lib/markdown";
import type { RegisterState, StageState } from "@/lib/actions/competition-public";

/**
 * Answering a competition form, one lettered part at a time.
 *
 * Every part stays in the DOM (hidden, not unmounted) so the final post carries
 * all of them, but member blocks past the chosen count *are* unmounted: choose
 * four, fill them in, change to one, and members two to four are gone from the
 * post as well as the screen. The server re-checks the same thing with the same
 * function, so this is a convenience, not the control.
 */

type Values = Record<string, string>;

export type PaymentPanel = {
  payeeName: string;
  bankName: string;
  accountNumber: string;
  promptPayId: string;
  paymentQr: string;
  expectedFee: string;
  refundPolicy: string;
};

export type TeamSummary = { code: string; name: string; roster: string[] };

type Common = {
  formId: string;
  sections: CSection[];
  maxBytes: number;
  submitLabel: string;
};

type RegisterProps = Common & {
  mode: "register";
  action: (state: RegisterState, formData: FormData) => Promise<RegisterState>;
  payment?: PaymentPanel | null;
};

type StageProps = Common & {
  mode: "F" | "H";
  action: (state: StageState, formData: FormData) => Promise<StageState>;
  token: string;
  team: TeamSummary;
  deadlineText?: string;
  naming?: ReactNode;
};

const md = (source: string) => ({ __html: renderMarkdown(source, { breaks: true }) });

function readValues(form: HTMLFormElement | null): Values {
  const out: Values = {};
  if (!form) return out;
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (typeof value === "string" && key.startsWith("c_")) out[key] = value;
  }
  return out;
}

function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function CompetitionForm(props: RegisterProps | StageProps) {
  const register = props.mode === "register";
  const formRef = useRef<HTMLFormElement | null>(null);
  const [values, setValues] = useState<Values>({});
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [idempotencyKey] = useState(newKey);

  const [registerState, registerAction] = useActionState(
    register ? (props as RegisterProps).action : async (s: RegisterState) => s,
    {} as RegisterState,
  );
  const [stageState, stageAction] = useActionState(
    register ? async (s: StageState) => s : (props as StageProps).action,
    {} as StageState,
  );
  const serverError = register ? registerState.error : stageState.error;
  const serverField = register ? registerState.field : stageState.field;

  const read = (name: string) => values[name] ?? "";
  const members = register
    ? memberCountFrom(props.sections, read)
    : (props as StageProps).team.roster.length;

  const sections = props.sections;
  const last = step === sections.length - 1;

  // Jump to the part holding the field the server complained about.
  useEffect(() => {
    if (!serverField) return;
    const index = sections.findIndex((s) =>
      expandSection(s, MAX_MEMBERS).some((q) => fieldName(q.id) === serverField),
    );
    if (index >= 0) {
      setStep(index);
      setReviewing(false);
    }
  }, [serverError, serverField, sections]);

  const checkSections = (list: CSection[]) => {
    const form = formRef.current;
    if (!form) return "Please reload the page.";
    const result = validateQuestions(list, new FormData(form), {
      members: register ? (list.some((s) => s.questions.some((q) => q.type === "member_count")) ? null : members) : members,
      maxBytes: props.maxBytes,
      memberNames: register ? undefined : (props as StageProps).team.roster,
    });
    if (!result.ok) {
      const el = form.querySelector<HTMLElement>(`[name="${result.field ?? ""}"]`);
      el?.focus();
      return result.error;
    }
    return "";
  };

  const next = () => {
    const error = checkSections([sections[step]]);
    setStepError(error);
    if (error) return;
    setStep((s) => Math.min(s + 1, sections.length - 1));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const back = () => {
    setStepError("");
    setStep((s) => Math.max(0, s - 1));
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // --- Done -----------------------------------------------------------------
  if (register && registerState.done) {
    const done = registerState.done;
    return <RegistrationReceipt done={done} />;
  }
  if (!register && stageState.done) {
    return (
      <div role="status" className="space-y-4">
        <p className="text-4xl" aria-hidden="true">✓</p>
        <div className="hs-prose hs-prose-compact" dangerouslySetInnerHTML={md(stageState.done.receipt)} />
      </div>
    );
  }

  const stopMessage = sections[step]
    ? expandSection(sections[step], members)
        .filter((q) => q.stop && isVisible(q, read) && read(fieldName(q.id)) === q.stop.value)
        .map((q) => q.stop!.message)[0]
    : undefined;

  return (
    <form
      ref={formRef}
      action={register ? registerAction : stageAction}
      noValidate
      onChange={() => setValues(readValues(formRef.current))}
      className="relative space-y-6"
    >
      <input type="hidden" name="formId" value={props.formId} />
      {register ? <input type="hidden" name="idempotencyKey" value={idempotencyKey} /> : null}
      {!register ? <input type="hidden" name="token" value={(props as StageProps).token} /> : null}
      <div className="hs-honeypot" aria-hidden="true">
        <label htmlFor="company_website">Company website (leave this empty)</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {sections.length > 1 ? (
        <ol className="flex flex-wrap gap-1.5" aria-label="Parts of this form">
          {sections.map((s, i) => (
            <li key={s.key}>
              <span
                className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2.5 text-xs font-bold ${
                  i === step ? "bg-brand-solid text-on-brand" : i < step ? "bg-tint text-brand-deep" : "bg-surface-2 text-faint"
                }`}
                aria-current={i === step ? "step" : undefined}
              >
                {s.key}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {sections.map((section, index) => (
        <fieldset key={section.key} hidden={index !== step || reviewing} className="space-y-6">
          <legend className="text-lg font-bold text-ink">{section.title}</legend>
          {section.intro ? <p className="text-sm text-muted">{section.intro}</p> : null}
          {register && section.key === "E" && (props as RegisterProps).payment ? (
            <PaymentDetails payment={(props as RegisterProps).payment!} />
          ) : null}
          <SectionFields
            section={section}
            members={members}
            read={read}
            maxBytes={props.maxBytes}
            team={register ? null : (props as StageProps).team}
          />
        </fieldset>
      ))}

      {reviewing && !register ? (
        <ReviewPanel
          values={values}
          sections={sections}
          members={members}
          team={(props as StageProps).team}
          deadlineText={(props as StageProps).deadlineText}
        />
      ) : null}

      {stopMessage ? (
        <p role="alert" className="hs-feedback hs-feedback-error">
          <span aria-hidden="true">⚠</span> {stopMessage}
        </p>
      ) : null}
      {stepError ? (
        <p role="alert" className="hs-feedback hs-feedback-error">
          <span aria-hidden="true">⚠</span> {stepError}
        </p>
      ) : serverError ? (
        <p role="alert" className="hs-feedback hs-feedback-error">
          <span aria-hidden="true">⚠</span> {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {step > 0 && !reviewing ? (
          <button type="button" onClick={back} className="hs-btn hs-btn-secondary">
            Back
          </button>
        ) : null}
        {reviewing ? (
          <button type="button" onClick={() => setReviewing(false)} className="hs-btn hs-btn-secondary">
            Go back and edit
          </button>
        ) : null}

        {!last ? (
          <button type="button" onClick={next} disabled={Boolean(stopMessage)} className="hs-btn hs-btn-primary">
            Next
          </button>
        ) : register || reviewing ? (
          <Submit
            label={props.submitLabel}
            disabled={Boolean(stopMessage)}
            onBeforeSubmit={() => {
              const error = checkSections(sections);
              setStepError(error);
              return !error;
            }}
          />
        ) : (
          <button
            type="button"
            className="hs-btn hs-btn-primary"
            onClick={() => {
              const error = checkSections(sections);
              setStepError(error);
              if (!error) {
                setReviewing(true);
                formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }}
          >
            Review before submitting
          </button>
        )}
      </div>
    </form>
  );
}

function Submit({
  label,
  disabled,
  onBeforeSubmit,
}: {
  label: string;
  disabled: boolean;
  onBeforeSubmit: () => boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="hs-btn hs-btn-primary"
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(event) => {
        if (!onBeforeSubmit()) event.preventDefault();
      }}
    >
      {pending ? (
        <>
          <span className="hs-spinner" aria-hidden="true" />
          Sending…
        </>
      ) : (
        label
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function SectionFields({
  section,
  members,
  read,
  maxBytes,
  team,
}: {
  section: CSection;
  members: number;
  read: (name: string) => string;
  maxBytes: number;
  team: TeamSummary | null;
}) {
  const questions = expandSection(section, members);
  const blocks: ReactNode[] = [];
  let currentMember: number | null = null;
  let group: ReactNode[] = [];

  const flush = () => {
    if (group.length === 0) return;
    if (currentMember !== null) {
      blocks.push(
        <div key={`member-${currentMember}`} className="space-y-5 rounded-2xl border border-line p-4 sm:p-5">
          <p className="text-sm font-bold text-brand-deep">
            Member {currentMember}
            {currentMember === 1 && !team ? <span className="ml-1 font-normal text-faint">· team representative</span> : null}
            {team && team.roster[currentMember - 1] ? (
              <span className="ml-1 font-normal text-faint">· {team.roster[currentMember - 1]}</span>
            ) : null}
          </p>
          {group}
        </div>,
      );
    } else {
      blocks.push(...group);
    }
    group = [];
  };

  for (const q of questions) {
    if (q.member !== currentMember) {
      flush();
      currentMember = q.member;
    }
    if (!isVisible(q, read)) continue;
    group.push(<Field key={q.id} q={q} maxBytes={maxBytes} team={team} />);
  }
  flush();

  if (section.memberQuestions && members === 0) {
    blocks.unshift(
      <p key="no-count" className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
        Choose how many members are on your team in Part A first.
      </p>,
    );
  }

  return <div className="space-y-6">{blocks}</div>;
}

function Label({ q, htmlFor }: { q: Concrete; htmlFor?: string }) {
  const inner = (
    <>
      <span className="text-sm font-semibold text-ink">{q.label}</span>
      {q.required ? (
        <>
          <span className="ml-1 text-danger-strong" aria-hidden="true">*</span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </>
  );
  return htmlFor ? (
    <label htmlFor={htmlFor} className="block">
      {inner}
    </label>
  ) : (
    <span className="block">{inner}</span>
  );
}

function Help({ q }: { q: Concrete }) {
  return q.help ? <p className="mt-1 text-xs text-faint">{q.help}</p> : null;
}

function Field({ q, maxBytes, team }: { q: Concrete; maxBytes: number; team: TeamSummary | null }) {
  const name = fieldName(q.id);
  const id = `f-${q.id}`;

  switch (q.type) {
    case "display": {
      const value =
        q.display === "team_code"
          ? team?.code
          : q.display === "team_name"
            ? team?.name
            : team
              ? `${team.code} · ${team.roster.join(", ")}`
              : "";
      return (
        <div>
          <Label q={q} />
          <p className="mt-1.5 rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm text-ink">{value}</p>
        </div>
      );
    }
    case "radio":
    case "member_count": {
      const options = q.type === "member_count" ? ["1", "2", "3", "4"] : (q.options ?? []);
      return (
        <fieldset>
          <legend>
            <Label q={q} />
          </legend>
          <Help q={q} />
          <div className={`mt-2.5 ${q.type === "member_count" ? "flex flex-wrap gap-2" : "space-y-1.5"}`}>
            {options.map((option) => (
              <label
                key={option}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted transition hover:bg-tint/60 ${
                  q.type === "member_count" ? "border border-line px-3" : ""
                }`}
              >
                <input type="radio" name={name} value={option} className="accent-pink-500" />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case "member_select":
      return (
        <div>
          <Label q={q} htmlFor={id} />
          <Help q={q} />
          <select id={id} name={name} className="hs-input mt-2.5" defaultValue="">
            <option value="">Choose…</option>
            {(team?.roster ?? []).map((member) => (
              <option key={member} value={member}>
                {member}
              </option>
            ))}
          </select>
        </div>
      );
    case "confirm":
      return (
        <div className="rounded-xl border border-line p-3">
          <p className="text-sm text-ink">
            {q.label}
            {q.required ? <span className="ml-1 text-danger-strong" aria-hidden="true">*</span> : null}
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm font-semibold text-brand-deep">
            <input type="checkbox" name={name} value="yes" className="accent-pink-500" />
            {q.confirmLabel ?? "I confirm"}
          </label>
        </div>
      );
    case "long_text":
      return (
        <div>
          <Label q={q} htmlFor={id} />
          <Help q={q} />
          <textarea id={id} name={name} rows={4} maxLength={5000} className="hs-input mt-2.5 resize-y" />
        </div>
      );
    case "document":
      return (
        <div>
          <Label q={q} htmlFor={id} />
          <Help q={q} />
          <FilePicker id={id} name={name} maxBytes={maxBytes} />
        </div>
      );
    case "proof":
      return <ProofField q={q} id={id} name={name} maxBytes={maxBytes} />;
    default: {
      const type =
        q.type === "email"
          ? "email"
          : q.type === "number"
            ? "number"
            : q.type === "date"
              ? "date"
              : q.type === "drive_folder"
                ? "url"
                : "text";
      const placeholder =
        q.type === "time"
          ? "14:05"
          : q.type === "duration"
            ? "03:45"
            : q.type === "drive_folder"
              ? "https://drive.google.com/drive/folders/…"
              : undefined;
      return (
        <div>
          <Label q={q} htmlFor={id} />
          <Help q={q} />
          <input
            id={id}
            name={name}
            type={type}
            inputMode={q.type === "time" || q.type === "duration" ? "numeric" : undefined}
            placeholder={placeholder}
            maxLength={q.type === "drive_folder" ? 1000 : 500}
            className="hs-input mt-2.5"
          />
        </div>
      );
    }
  }
}

function ProofField({ q, id, name, maxBytes }: { q: Concrete; id: string; name: string; maxBytes: number }) {
  const mode = q.proofMode ?? "either";
  const [method, setMethod] = useState<"upload" | "link">(mode === "link" ? "link" : "upload");
  return (
    <div>
      <Label q={q} htmlFor={method === "upload" ? id : `${id}-link`} />
      <Help q={q} />
      {mode === "either" ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="How to provide it">
          {(["upload", "link"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
              className="hs-chip-toggle"
              aria-pressed={method === m}
            >
              {m === "upload" ? "Upload a photo or PDF" : "Paste a receipt link"}
            </button>
          ))}
        </div>
      ) : null}
      {method === "upload" ? (
        <FilePicker id={id} name={name} maxBytes={maxBytes} />
      ) : (
        <input
          id={`${id}-link`}
          name={`${name}__link`}
          type="url"
          placeholder="https://…"
          maxLength={1000}
          className="hs-input mt-2.5"
        />
      )}
    </div>
  );
}

/**
 * One photo or PDF. Large photos from a phone are shrunk in the browser before
 * they are sent (longest side 2000px, JPEG), so four members' documents and a
 * payment slip fit comfortably in one registration. HEIC is sent as it is:
 * most browsers cannot decode it, and the server accepts it.
 */
function FilePicker({ id, name, maxBytes }: { id: string; name: string; maxBytes: number }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<{ name: string; size: number; preview: string | null } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (file?.preview) URL.revokeObjectURL(file.preview);
  }, [file]);

  const onChange = async () => {
    const input = inputRef.current;
    const picked = input?.files?.[0];
    setError("");
    if (!input || !picked) {
      setFile(null);
      return;
    }
    let chosen = picked;
    if (/^image\/(jpeg|png|webp)$/.test(picked.type) && picked.size > 1_200_000) {
      setBusy(true);
      const smaller = await shrinkImage(picked).catch(() => null);
      setBusy(false);
      if (smaller && smaller.size < picked.size) {
        const transfer = new DataTransfer();
        transfer.items.add(smaller);
        input.files = transfer.files;
        chosen = smaller;
      }
    }
    if (chosen.size > maxBytes) {
      setError(`That file is ${formatBytes(chosen.size)}. The limit is ${formatBytes(maxBytes)}.`);
    }
    setFile({
      name: chosen.name,
      size: chosen.size,
      preview: chosen.type.startsWith("image/") ? URL.createObjectURL(chosen) : null,
    });
    input.form?.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <div className="mt-2.5">
      <label
        htmlFor={id}
        className="block cursor-pointer rounded-xl border-2 border-dashed border-line px-4 py-5 text-center transition hover:border-brand"
      >
        <span className="text-sm text-muted">
          {file ? "Choose a different file" : "Tap to choose a photo or PDF"}
        </span>
        <span className="mt-1 block text-xs text-faint">
          One file, up to {formatBytes(maxBytes)}. Photos: PNG, JPG, GIF, WebP, AVIF, HEIC.
        </span>
      </label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="file"
        accept="image/*,.heic,.avif,application/pdf,.pdf"
        className="sr-only"
        onChange={onChange}
      />
      {busy ? <p className="mt-1.5 text-xs text-faint">Making the photo smaller…</p> : null}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-danger-strong">
          {error}
        </p>
      ) : null}
      {file ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-line p-2">
          {file.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.preview} alt="" className="h-14 w-14 rounded object-cover" />
          ) : (
            <span className="text-2xl" aria-hidden="true">
              📄
            </span>
          )}
          <span className="min-w-0 truncate text-xs text-muted">
            {file.name} · {formatBytes(file.size)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

async function shrinkImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85),
  );
  const base = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

// ---------------------------------------------------------------------------
// Payment, review and receipt
// ---------------------------------------------------------------------------

function PaymentDetails({ payment }: { payment: PaymentPanel }) {
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-tint/40 p-4 text-sm">
      <p className="font-semibold text-ink">Pay {payment.expectedFee || "599"} THB to:</p>
      <dl className="grid gap-1 text-muted sm:grid-cols-[auto_1fr] sm:gap-x-4">
        {payment.payeeName ? (
          <>
            <dt className="text-faint">Payee</dt>
            <dd className="font-semibold text-ink">{payment.payeeName}</dd>
          </>
        ) : null}
        {payment.bankName ? (
          <>
            <dt className="text-faint">Bank</dt>
            <dd>{payment.bankName}</dd>
          </>
        ) : null}
        {payment.accountNumber ? (
          <>
            <dt className="text-faint">Account number</dt>
            <dd className="font-mono">{payment.accountNumber}</dd>
          </>
        ) : null}
        {payment.promptPayId ? (
          <>
            <dt className="text-faint">PromptPay</dt>
            <dd className="font-mono">{payment.promptPayId}</dd>
          </>
        ) : null}
      </dl>
      {payment.paymentQr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={payment.paymentQr} alt="Payment QR code" className="h-48 w-48 rounded-lg border border-line bg-white object-contain p-1" />
      ) : null}
      {payment.refundPolicy ? (
        <div>
          <p className="font-semibold text-ink">Refunds and withdrawal</p>
          <div className="hs-prose hs-prose-compact mt-1" dangerouslySetInnerHTML={md(payment.refundPolicy)} />
        </div>
      ) : null}
    </div>
  );
}

function ReviewPanel({
  values,
  sections,
  members,
  team,
  deadlineText,
}: {
  values: Values;
  sections: CSection[];
  members: number;
  team: TeamSummary;
  deadlineText?: string;
}) {
  const read = (name: string) => values[name] ?? "";
  const rows = sections
    .flatMap((s) => expandSection(s, members))
    .filter((q) => isVisible(q, read) && q.type !== "confirm" && q.type !== "display");

  return (
    <div className="space-y-4 rounded-2xl border-2 border-brand p-4 sm:p-5">
      <p className="text-lg font-bold text-ink">Check before you submit</p>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-faint">Team ID</dt>
          <dd className="font-mono font-semibold text-ink">{team.code}</dd>
        </div>
        <div>
          <dt className="text-faint">Team name</dt>
          <dd className="text-ink">{team.name}</dd>
        </div>
        {rows.map((q) => (
          <div key={q.id}>
            <dt className="text-faint">{q.label}</dt>
            <dd className="break-all text-ink">{read(fieldName(q.id)) || "—"}</dd>
          </div>
        ))}
        {deadlineText ? (
          <div>
            <dt className="text-faint">Deadline</dt>
            <dd className="text-ink">{deadlineText}</dd>
          </div>
        ) : null}
      </dl>
      <p className="hs-feedback hs-feedback-error">
        <span aria-hidden="true">🔒</span> Once you submit, your answers are locked and cannot be edited. Do not
        change, rename or remove anything in the folder, or its sharing, after you submit.
      </p>
    </div>
  );
}

function RegistrationReceipt({ done }: { done: NonNullable<RegisterState["done"]> }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => md(done.receipt), [done.receipt]);
  return (
    <div role="status" className="space-y-5">
      <p className="text-4xl" aria-hidden="true">✓</p>
      <p className="text-sm text-faint">Team ID</p>
      <p className="-mt-4 font-mono text-3xl font-bold text-brand-deep">{done.teamCode}</p>
      <div className="hs-prose hs-prose-compact" dangerouslySetInnerHTML={html} />
      <div className="space-y-2 rounded-2xl border border-line p-4">
        <p className="text-sm font-semibold text-ink">Your team&apos;s private link</p>
        <p className="text-xs text-muted">
          Save this link. It is the only way back to Part F to submit your Round 1 work. Anyone with it can submit for
          your team, so share it only with your teammates.
          {done.emailed ? " We also emailed it to Member 1." : ""}
        </p>
        <p className="break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink">{done.continueUrl}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(done.continueUrl).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a href={done.continueUrl} className="hs-btn hs-btn-primary">
            Continue to Round 1 submission
          </a>
        </div>
      </div>
    </div>
  );
}
