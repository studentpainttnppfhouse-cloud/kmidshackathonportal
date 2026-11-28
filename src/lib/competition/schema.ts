import { z } from "zod";
import { extensionOf, formatBytes } from "@/lib/attachments";

/**
 * The competition registration forms: their shape, and the one validator.
 *
 * A competition form is not a flat question list. Registration runs through
 * lettered parts (internal A, C, D; external A, B, C, D, E), part C repeats once
 * per team member, some questions only appear after a given answer, and the
 * Round 1 work (stage F) and finalist confirmation (stage H) are separate
 * stages saved against the same team.
 *
 * The browser and the server both call `validateQuestions()` with a FormData,
 * so a solo team is checked for exactly one member block in both places, and a
 * hidden question is never required in either.
 *
 * Question ids are stable and never depend on the label, the member count or
 * the order on screen: "I-C{n}-01" becomes "I-C1-01", "I-C2-01" and so on.
 */

export const TRACKS = ["internal", "external"] as const;
export type Track = (typeof TRACKS)[number];

export const C_TYPES = [
  "short_text",
  "long_text",
  "radio",
  /** One required tick: "I confirm" / "I understand". */
  "confirm",
  "email",
  "number",
  "date",
  /** HH:mm, 24-hour. */
  "time",
  /** mm:ss, at most 04:00. */
  "duration",
  /** One Google Drive folder link. */
  "drive_folder",
  /** Payment proof: an uploaded image or PDF, or an https receipt link. */
  "proof",
  /** An identity or school document: one image or PDF. */
  "document",
  /** How many members (1 to 4). Drives the repeated member block. */
  "member_count",
  /** Pick one registered member (stage H). */
  "member_select",
  /** Shown, never answered (team ID, team name, roster). */
  "display",
] as const;
export type CType = (typeof C_TYPES)[number];

const condition = z.object({ q: z.string().max(40), equals: z.string().max(160) });

export const cQuestionSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(C_TYPES),
  label: z.string().trim().min(1).max(500),
  help: z.string().trim().max(800).optional(),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  /** The tick-box text for a "confirm" question. */
  confirmLabel: z.string().trim().max(60).optional(),
  /** Only shown, and only required, when another answer matches. */
  showIf: condition.optional(),
  /** An answer that stops the form, with the reason shown. */
  stop: z.object({ value: z.string().max(160), message: z.string().max(500) }).optional(),
  /** Number questions: the expected value. A different one is flagged for staff. */
  expect: z.string().max(20).optional(),
  /** Proof questions: which methods the respondent may use. */
  proofMode: z.enum(["upload", "link", "either"]).optional(),
  /** Questions an author may switch off (the member documents). */
  enabled: z.boolean().optional(),
  /** Readonly questions: what to show. */
  display: z.enum(["team_code", "team_name", "roster"]).optional(),
  /** Structural questions keep their type, options and required flag. */
  locked: z.boolean().optional(),
});
export type CQuestion = z.infer<typeof cQuestionSchema>;

export const cSectionSchema = z.object({
  key: z.string().max(4),
  title: z.string().trim().min(1).max(200),
  intro: z.string().trim().max(4000).optional(),
  questions: z.array(cQuestionSchema).max(40).default([]),
  /** Repeated once per member, with {n} replaced by the member number. */
  memberQuestions: z.array(cQuestionSchema).max(20).optional(),
  /** Shown once, after the member blocks. */
  after: z.array(cQuestionSchema).max(20).optional(),
});
export type CSection = z.infer<typeof cSectionSchema>;

export const cStageSchema = z.object({
  key: z.enum(["F", "H"]),
  title: z.string().trim().min(1).max(200),
  /** Markdown, rendered with the portal's escape-first renderer. */
  intro: z.string().trim().max(8000),
  sections: z.array(cSectionSchema).min(1).max(6),
  submitLabel: z.string().trim().min(1).max(60),
  receipt: z.string().trim().max(1500),
});
export type CStage = z.infer<typeof cStageSchema>;

export const competitionDefinitionSchema = z.object({
  kind: z.literal("competition"),
  version: z.literal(2),
  templateKey: z.string().max(64),
  track: z.enum(TRACKS),
  year: z.number().int().min(2020).max(2100),
  title: z.string().trim().min(1).max(200),
  /** Markdown. */
  intro: z.string().trim().max(8000),
  sections: z.array(cSectionSchema).min(1).max(8),
  registerLabel: z.string().trim().min(1).max(60),
  receipt: z.string().trim().max(1500),
  f: cStageSchema,
  h: cStageSchema,
});
export type CompetitionDefinition = z.infer<typeof competitionDefinitionSchema>;

export function parseCompetitionDefinition(raw: unknown): CompetitionDefinition | null {
  const parsed = competitionDefinitionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Organizer settings
// ---------------------------------------------------------------------------

const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((value) => value === "" || /^https:\/\/[^\s"'<>]+$/i.test(value), "Links must start with https://");

export const settingsSchema = z.object({
  rulesUrl: httpsUrl.default(""),
  privacyUrl: httpsUrl.default(""),
  promptUrl: httpsUrl.default(""),
  rubricUrl: httpsUrl.default(""),
  /** Organizer confirms the closing time is the published one, not a guess. */
  closeTimeConfirmed: z.boolean().default(false),
  /** Internal track: the deadline is confirmed to match external. */
  internalDeadlineConfirmed: z.boolean().default(false),
  /** How reviewers open folders. */
  reviewerAccess: z.enum(["", "anyone_with_link", "reviewer_account"]).default(""),
  reviewerEmail: z.string().trim().max(254).default(""),
  /** External track payment details. */
  payeeName: z.string().trim().max(200).default(""),
  bankName: z.string().trim().max(200).default(""),
  accountNumber: z.string().trim().max(60).default(""),
  promptPayId: z.string().trim().max(60).default(""),
  /** A payment QR image: an https URL or a small data URL. */
  paymentQr: z
    .string()
    .max(1_500_000)
    .refine(
      (value) =>
        value === "" ||
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ||
        /^https:\/\/[^\s"'<>]+$/.test(value),
      "The QR has to be an image.",
    )
    .default(""),
  expectedFee: z.string().trim().max(20).default("599"),
  refundPolicy: z.string().trim().max(3000).default(""),
  /** Capacity: the number, and the organizer's decision on how it is counted. */
  capacity: z.string().trim().max(10).default(""),
  capacityDecided: z.boolean().default(false),
  capacityNote: z.string().trim().max(1000).default(""),
  /** Needed before stage H, not before Round 1. */
  guardianConsentText: z.string().trim().max(3000).default(""),
  finalPromptNote: z.string().trim().max(2000).default(""),
  aiRulesNote: z.string().trim().max(2000).default(""),
  /** The owner may let admins publish, open and close. */
  publishDelegatedToAdmins: z.boolean().default(false),

  // --- Shown inside the site (pop-ups and their own pages) -----------------
  /** Rules & Information, as Markdown, shown in a pop-up and on its own page. */
  rulesContent: z.string().trim().max(30000).default(""),
  /** The approved PDPA privacy notice, as Markdown. Never pre-filled. */
  privacyContent: z.string().trim().max(30000).default(""),
  /** External payment instructions, as Markdown, above Part E. */
  paymentInstructions: z.string().trim().max(5000).default(""),
  /** Up to four images shown with the payment instructions (small data URLs). */
  paymentImages: z
    .array(
      z
        .string()
        .max(1_000_000)
        .refine((v) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Payment images must be images."),
    )
    .max(4)
    .default([]),

  // --- Consent forms (two parts) -------------------------------------------
  /** Round 1 consent text (Markdown). Opens once staff accept the registration. */
  consentRound1Text: z.string().trim().max(20000).default(""),
  /** Round 2 (on-site final) consent text (Markdown). Opens for finalists. */
  consentRound2Text: z.string().trim().max(20000).default(""),
  /** An admin confirms the consent wording is approved before it opens. */
  consentApproved: z.boolean().default(false),
  /** Optional due dates shown to teams, YYYY-MM-DD (Bangkok). */
  consentRound1Due: z.string().trim().max(10).default(""),
  consentRound2Due: z.string().trim().max(10).default(""),

  /** Set once the organizer's agreed defaults have been filled in. */
  defaultsApplied: z.boolean().default(false),
});
export type CompetitionSettings = z.infer<typeof settingsSchema>;

export function parseSettings(raw: unknown): CompetitionSettings {
  const parsed = settingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : settingsSchema.parse({});
}

export type SettingIssue = { key: string; label: string; blocksPublish: boolean };

/**
 * What the organizer still has to decide. Nothing here is guessed: until a
 * setting is filled in, it is listed, and the ones marked `blocksPublish` keep
 * the public link switched off.
 */
export function unresolvedSettings(
  track: Track,
  settings: CompetitionSettings,
  timing: { opensAt: Date | null; closesAt: Date | null },
): SettingIssue[] {
  const issues: SettingIssue[] = [];
  const need = (ok: boolean, key: string, label: string, blocksPublish = true) => {
    if (!ok) issues.push({ key, label, blocksPublish });
  };

  need(timing.opensAt !== null, "opensAt", "Opening date and time");
  need(timing.closesAt !== null, "closesAt", "Closing date and time");
  need(settings.closeTimeConfirmed, "closeTimeConfirmed", "Closing time confirmed as the published one");
  need(settings.rulesUrl !== "", "rulesUrl", "Rules & Information link (acknowledgement D07 points at it)");
  need(settings.privacyUrl !== "", "privacyUrl", "Approved privacy notice link");
  need(settings.reviewerAccess !== "", "reviewerAccess", "Reviewer access method for Round 1 folders");
  if (settings.reviewerAccess === "reviewer_account") {
    need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.reviewerEmail), "reviewerEmail", "Reviewer account email");
  }

  if (track === "internal") {
    need(settings.internalDeadlineConfirmed, "internalDeadlineConfirmed", "Internal deadline confirmed");
  } else {
    need(settings.payeeName !== "", "payeeName", "Payee name");
    need(
      settings.accountNumber !== "" || settings.promptPayId !== "" || settings.paymentQr !== "",
      "paymentMethod",
      "Bank account, PromptPay ID or payment QR",
    );
    need(settings.refundPolicy !== "", "refundPolicy", "Refund and withdrawal policy");
    need(settings.capacityDecided, "capacity", "Entry cap and how it is counted");
  }

  need(settings.promptUrl !== "", "promptUrl", "Published Round 1 prompt link", false);
  need(settings.rubricUrl !== "", "rubricUrl", "Published rubric link", false);
  need(settings.guardianConsentText !== "", "guardianConsentText", "Guardian consent text (needed before stage H)", false);
  need(settings.finalPromptNote !== "", "finalPromptNote", "Final prompt and stage AI rules (needed before the final)", false);

  return issues;
}

// ---------------------------------------------------------------------------
// Expanding sections into concrete questions
// ---------------------------------------------------------------------------

export const MAX_MEMBERS = 4;

/** A question with its member number filled in. */
export type Concrete = CQuestion & { baseId: string; member: number | null };

function concrete(question: CQuestion, member: number | null): Concrete {
  if (member === null) return { ...question, baseId: question.id, member: null };
  const n = String(member);
  return {
    ...question,
    baseId: question.id,
    member,
    id: question.id.replace(/\{n\}/g, n),
    label: question.label.replace(/\{n\}/g, n),
    help: question.help?.replace(/\{n\}/g, n),
  };
}

export function isEnabled(question: CQuestion): boolean {
  return question.enabled !== false;
}

/** The questions of one section, member blocks repeated `members` times. */
export function expandSection(section: CSection, members: number): Concrete[] {
  const out: Concrete[] = [];
  for (const q of section.questions) if (isEnabled(q)) out.push(concrete(q, null));
  if (section.memberQuestions) {
    for (let n = 1; n <= members; n += 1) {
      for (const q of section.memberQuestions) if (isEnabled(q)) out.push(concrete(q, n));
    }
  }
  for (const q of section.after ?? []) if (isEnabled(q)) out.push(concrete(q, null));
  return out;
}

/** Reads the member count out of a set of answers. 0 when not chosen yet. */
export function memberCountFrom(sections: CSection[], read: (name: string) => string): number {
  for (const section of sections) {
    for (const q of section.questions) {
      if (q.type !== "member_count") continue;
      const n = Number.parseInt(read(fieldName(q.id)), 10);
      return Number.isInteger(n) && n >= 1 && n <= MAX_MEMBERS ? n : 0;
    }
  }
  return 0;
}

export function fieldName(id: string): string {
  return `c_${id}`;
}

/** Whether a question is on screen, given the answers so far. */
export function isVisible(question: CQuestion, read: (name: string) => string): boolean {
  if (!question.showIf) return true;
  return read(fieldName(question.showIf.q)) === question.showIf.equals;
}

// ---------------------------------------------------------------------------
// Value rules
// ---------------------------------------------------------------------------

export const DOCUMENT_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "pdf"];
/** One registration, every file together. The action body limit is 24 MB. */
export const MAX_REGISTRATION_BYTES = 20 * 1024 * 1024;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A Google Drive folder link, made canonical, or null.
 *
 * Only `drive.google.com/drive/folders/{id}` is accepted. An `open?id=` link
 * can point at a file or a folder, and telling which needs a request to Google
 * that the portal never makes on a respondent's behalf, so those are refused
 * with a message asking for the folder link instead. A `resourcekey` (older
 * shared folders need it) is kept.
 */
export function normalizeDriveFolder(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com") return null;
  if (url.username || url.password || url.port) return null;
  const match = /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,100})\/?$/.exec(url.pathname);
  if (!match) return null;
  const key = url.searchParams.get("resourcekey");
  const keep = key && /^[A-Za-z0-9_-]{1,100}$/.test(key) ? `?resourcekey=${key}` : "";
  return `https://drive.google.com/drive/folders/${match[1]}${keep}`;
}

/** "03:45" -> 225. Null if it is not mm:ss. */
export function durationSeconds(raw: string): number | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(raw.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export const MAX_VIDEO_SECONDS = 4 * 60;

export function isSafeHttpsLink(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" && !url.username && !url.password && raw.trim().length <= 1000;
  } catch {
    return false;
  }
}

/** A team name as it may appear in a file or folder name. */
export function fileSafeName(name: string): string {
  return name
    .normalize("NFC")
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

export function teamCode(track: Track, seq: number): string {
  return `${track}${String(seq).padStart(2, "0")}`;
}

/** The folder and file names a team should use, from its saved details. */
export function namingFor(code: string, teamName: string) {
  const base = `${code}_${fileSafeName(teamName)}`;
  return {
    folder: `${base}_Round1_2027`,
    video: `${base}_VideoPitch.mp4`,
    deck: `${base}_PitchDeck.pdf`,
    brief: `${base}_ImpactBrief.pdf`,
    videoLink: `${base}_VideoPitchLink.pdf`,
  };
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

export type CAnswers = Record<string, string>;

type FileLike = { name: string; size: number; type?: string };

export type ValidationResult =
  | {
      ok: true;
      answers: CAnswers;
      /** Question id -> the one file chosen for it. */
      files: Record<string, FileLike>;
      /** Concrete questions that were on screen, in order. */
      shown: Concrete[];
      memberCount: number;
      /** Things staff should look at, e.g. an unexpected payment amount. */
      flags: string[];
    }
  | { ok: false; error: string; field?: string };

function readEntry(raw: FormData, name: string): string {
  const value = raw.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function readFile(raw: FormData, name: string): FileLike | null {
  const value = raw.get(name);
  if (value && typeof value === "object" && "size" in value && (value as FileLike).size > 0) {
    return value as FileLike;
  }
  return null;
}

export function checkDocumentFile(label: string, file: FileLike, maxBytes: number): string | null {
  if (!DOCUMENT_EXTENSIONS.includes(extensionOf(file.name))) {
    return `"${label}" takes a photo (PNG, JPG, GIF, WebP, AVIF, HEIC) or a PDF.`;
  }
  if (file.size > maxBytes) {
    return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)} per file.`;
  }
  return null;
}

/**
 * Checks a set of sections against a submission.
 *
 * `members` is the member count to repeat member blocks for; pass null to read
 * it from the member-count question in these sections (registration). Anything
 * not on screen is dropped, so an answer left over from a fourth member who was
 * removed is never stored.
 */
export function validateQuestions(
  sections: CSection[],
  raw: FormData,
  options: { members: number | null; maxBytes: number; memberNames?: string[] },
): ValidationResult {
  const read = (name: string) => readEntry(raw, name);
  const members = options.members ?? memberCountFrom(sections, read);
  if (options.members === null && members === 0) {
    return { ok: false, error: "Choose how many members are on your team." };
  }

  const answers: CAnswers = {};
  const files: Record<string, FileLike> = {};
  const shown: Concrete[] = [];
  const flags: string[] = [];
  let totalBytes = 0;

  for (const section of sections) {
    for (const q of expandSection(section, members)) {
      if (!isVisible(q, read)) continue;
      shown.push(q);
      const name = fieldName(q.id);
      const fail = (error: string) => ({ ok: false as const, error, field: name });

      if (q.type === "display") continue;

      if (q.type === "document") {
        const file = readFile(raw, name);
        if (!file) {
          if (q.required) return fail(`"${q.label}" is required.`);
          continue;
        }
        const problem = checkDocumentFile(q.label, file, options.maxBytes);
        if (problem) return fail(problem);
        files[q.id] = file;
        totalBytes += file.size;
        continue;
      }

      if (q.type === "proof") {
        const mode = q.proofMode ?? "either";
        const file = mode === "link" ? null : readFile(raw, name);
        const link = mode === "upload" ? "" : read(`${name}__link`);
        if (file && link) return fail(`"${q.label}": choose either an upload or a link, not both.`);
        if (!file && !link) {
          if (q.required) return fail(`"${q.label}" is required.`);
          continue;
        }
        if (file) {
          const problem = checkDocumentFile(q.label, file, options.maxBytes);
          if (problem) return fail(problem);
          files[q.id] = file;
          totalBytes += file.size;
        } else {
          if (!isSafeHttpsLink(link)) return fail(`"${q.label}" needs an https:// receipt link.`);
          answers[q.id] = link;
        }
        continue;
      }

      const value = read(name);

      if (q.type === "confirm") {
        if (value !== "yes") {
          if (q.required) return fail(`Please tick "${q.confirmLabel ?? "I confirm"}" for: ${q.label}`);
          continue;
        }
        answers[q.id] = q.confirmLabel ?? "I confirm";
        continue;
      }

      if (value.length === 0) {
        if (q.required) return fail(`"${q.label}" is required.`);
        continue;
      }

      switch (q.type) {
        case "radio":
        case "member_count": {
          const allowed = q.type === "member_count" ? ["1", "2", "3", "4"] : (q.options ?? []);
          if (!allowed.includes(value)) return fail(`"${q.label}" got an answer that is not one of its options.`);
          if (q.stop && value === q.stop.value) return fail(q.stop.message);
          break;
        }
        case "member_select": {
          const names = options.memberNames ?? [];
          if (!names.includes(value)) return fail(`"${q.label}" has to be one of your registered members.`);
          break;
        }
        case "email":
          if (!EMAIL.test(value) || value.length > 254) return fail(`"${q.label}" needs an email address.`);
          break;
        case "number":
          if (!/^\d{1,9}(\.\d{1,2})?$/.test(value)) return fail(`"${q.label}" needs a number.`);
          if (q.expect && Number(value) !== Number(q.expect)) {
            flags.push(`${q.id}: ${value} (expected ${q.expect})`);
          }
          break;
        case "date":
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
            return fail(`"${q.label}" needs a date.`);
          }
          break;
        case "time":
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return fail(`"${q.label}" needs a time like 14:05.`);
          break;
        case "duration": {
          const seconds = durationSeconds(value);
          if (seconds === null) return fail(`"${q.label}" needs minutes and seconds, like 03:45.`);
          if (seconds <= 0 || seconds > MAX_VIDEO_SECONDS) {
            return fail("The video pitch can be at most 04:00 long.");
          }
          break;
        }
        case "drive_folder": {
          const folder = normalizeDriveFolder(value);
          if (!folder) {
            return fail(
              "Paste the link to your Google Drive folder. It should look like https://drive.google.com/drive/folders/… (a link to one file will not work).",
            );
          }
          answers[q.id] = folder;
          continue;
        }
        default:
          break;
      }

      const cap = q.type === "long_text" ? 5000 : 500;
      if (value.length > cap) return fail(`"${q.label}" is too long.`);
      answers[q.id] = value;
    }
  }

  if (totalBytes > MAX_REGISTRATION_BYTES) {
    return {
      ok: false,
      error: `These files add up to ${formatBytes(totalBytes)}. One registration can carry ${formatBytes(MAX_REGISTRATION_BYTES)}. Try smaller photos or PDFs.`,
    };
  }

  return { ok: true, answers, files, shown, memberCount: members, flags };
}

/** Which question holds the team name, the representative email and so on. */
export function keyQuestionIds(track: Track) {
  const p = track === "internal" ? "I" : "E";
  return {
    teamName: track === "internal" ? "I-A03" : "E-A04",
    memberCount: track === "internal" ? "I-A04" : "E-A05",
    memberName: (n: number) => `${p}-C${n}-01`,
    memberEmail: (n: number) => `${p}-C${n}-05`,
    representativeEmail: `${p}-C1-05`,
  };
}

/** Structural checks on an edited definition. Null when it is fine. */
export function checkCompetitionDefinition(definition: CompetitionDefinition): string | null {
  const ids = new Set<string>();
  const all = [
    ...definition.sections,
    ...definition.f.sections,
    ...definition.h.sections,
  ].flatMap((s) => [...s.questions, ...(s.memberQuestions ?? []), ...(s.after ?? [])]);
  for (const q of all) {
    if (ids.has(q.id)) return `Two questions share the id ${q.id}.`;
    ids.add(q.id);
    if (q.type === "radio" && (q.options ?? []).length === 0) return `"${q.label}" needs options.`;
    if (q.stop && !(q.options ?? []).includes(q.stop.value)) return `"${q.label}" lost the answer that stops the form.`;
  }
  const counts = definition.sections.flatMap((s) => s.questions).filter((q) => q.type === "member_count");
  if (counts.length !== 1) return "Registration needs exactly one member-count question.";
  return null;
}
