import { csvCell } from "@/lib/forms-schema";
import { MAX_MEMBERS, expandSection, type CAnswers, type CSection, type CompetitionDefinition, type Track } from "./schema";

/**
 * The competition CSV exports. Pure, so the column layout is tested.
 *
 * One row per team. Member questions are flattened into Member 1 to Member 4
 * columns, with the unused ones left blank. Every column header carries the
 * stable question id as well as the label, so a reworded question still lines
 * up with last month's export. Team IDs stay text (Excel keeps "internal01"
 * as typed), and every cell goes through the same formula-injection guard as
 * the portal's other exports.
 */

export type ExportStage = "registration" | "F" | "H";

export type ExportTeam = {
  teamCode: string;
  teamName: string;
  track: Track;
  memberCount: number;
  representativeEmail: string;
  registeredAt: Date;
  registrationStatus: string;
  paymentStatus: string;
  paymentFlag: string | null;
  accessChecked: boolean;
  finalist: boolean;
  schemaVersion: number;
  registration: { answers?: CAnswers; files?: Record<string, string> };
  submissions: {
    stage: string;
    status: string;
    reference: string | null;
    finalizedAt: Date | null;
    archiveStatus: string;
    archivedAt: Date | null;
    archiveNote: string | null;
    schemaVersion: number;
    payload: { answers?: CAnswers };
  }[];
};

export type FileRef = { name: string; url: string | null };

/** "2027-02-14 23:59:59 +07:00": Bangkok time, with the zone written out. */
export function bangkokCell(date: Date | null): string {
  if (!date) return "";
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19).replace("T", " ")} +07:00`;
}

type Column = { header: string; value: (team: ExportTeam) => string };

function questionColumns(
  sections: CSection[],
  answersOf: (team: ExportTeam) => CAnswers,
  filesOf: (team: ExportTeam) => Record<string, string>,
  fileRef: (id: string) => FileRef | null,
): Column[] {
  const columns: Column[] = [];
  const cell = (id: string) => (team: ExportTeam) => {
    const fileId = filesOf(team)[id];
    if (fileId) {
      const ref = fileRef(fileId);
      if (!ref) return "uploaded";
      return ref.url ? `${ref.name} (${ref.url})` : `${ref.name} (restricted)`;
    }
    return answersOf(team)[id] ?? "";
  };

  for (const section of sections) {
    // Team-level questions first, then each member's block, then "after".
    for (const q of expandSection({ ...section, memberQuestions: [], after: [] }, 0)) {
      if (q.type === "display") continue;
      columns.push({ header: `${q.id} ${q.label}`, value: cell(q.id) });
    }
    if (section.memberQuestions?.length) {
      for (let n = 1; n <= MAX_MEMBERS; n += 1) {
        for (const q of expandSection({ ...section, questions: [], after: [] }, n).filter((x) => x.member === n)) {
          columns.push({ header: `Member ${n}: ${q.id} ${q.label}`, value: cell(q.id) });
        }
      }
    }
    for (const q of expandSection({ ...section, questions: [], memberQuestions: [] }, 0)) {
      columns.push({ header: `${q.id} ${q.label}`, value: cell(q.id) });
    }
  }
  return columns;
}

export function buildCompetitionCsv(
  definition: CompetitionDefinition,
  stage: ExportStage,
  teams: ExportTeam[],
  fileRef: (id: string) => FileRef | null,
): string {
  const external = definition.track === "external";
  const sub = (team: ExportTeam, key: "F" | "H") => team.submissions.find((s) => s.stage === key);

  const base: Column[] = [
    { header: "Team ID", value: (t) => t.teamCode },
    { header: "Team name", value: (t) => t.teamName },
    { header: "Track", value: (t) => t.track },
    { header: "Stage", value: () => stage },
    { header: "Member count", value: (t) => String(t.memberCount) },
    { header: "Representative email", value: (t) => t.representativeEmail },
    { header: "Registered (Asia/Bangkok)", value: (t) => bangkokCell(t.registeredAt) },
    { header: "Registration status", value: (t) => t.registrationStatus },
  ];
  if (external) {
    base.push({ header: "Payment status", value: (t) => t.paymentStatus });
    base.push({ header: "Payment flag", value: (t) => t.paymentFlag ?? "" });
  }

  let columns: Column[];
  if (stage === "registration") {
    columns = [
      ...base,
      { header: "Round 1 status", value: (t) => sub(t, "F")?.status ?? "not submitted" },
      { header: "Round 1 submitted (Asia/Bangkok)", value: (t) => bangkokCell(sub(t, "F")?.finalizedAt ?? null) },
      { header: "Access checked", value: (t) => (t.accessChecked ? "yes" : "no") },
      { header: "Selected finalist", value: (t) => (t.finalist ? "yes" : "no") },
      { header: "Schema version", value: (t) => String(t.schemaVersion) },
      ...questionColumns(
        definition.sections,
        (t) => t.registration.answers ?? {},
        (t) => t.registration.files ?? {},
        fileRef,
      ),
    ];
  } else {
    const key = stage;
    const stageDef = key === "F" ? definition.f : definition.h;
    const nameIds = Array.from({ length: MAX_MEMBERS }, (_, i) => `${external ? "E" : "I"}-C${i + 1}-01`);
    columns = [
      ...base,
      ...nameIds.map((id, i) => ({
        header: `Member ${i + 1} name`,
        value: (t: ExportTeam) => (i < t.memberCount ? (t.registration.answers?.[id] ?? "") : ""),
      })),
      { header: `Stage ${key} status`, value: (t) => sub(t, key)?.status ?? "not submitted" },
      { header: "Submission reference", value: (t) => sub(t, key)?.reference ?? "" },
      { header: "Submitted (Asia/Bangkok)", value: (t) => bangkokCell(sub(t, key)?.finalizedAt ?? null) },
      { header: "Schema version", value: (t) => (sub(t, key) ? String(sub(t, key)!.schemaVersion) : "") },
      ...(key === "F"
        ? [
            { header: "Access checked", value: (t: ExportTeam) => (t.accessChecked ? "yes" : "no") },
            { header: "Organizer archive", value: (t: ExportTeam) => sub(t, "F")?.archiveStatus ?? "" },
            { header: "Archived (Asia/Bangkok)", value: (t: ExportTeam) => bangkokCell(sub(t, "F")?.archivedAt ?? null) },
            { header: "Archive note", value: (t: ExportTeam) => sub(t, "F")?.archiveNote ?? "" },
            { header: "Selected finalist", value: (t: ExportTeam) => (t.finalist ? "yes" : "no") },
          ]
        : []),
      ...questionColumns(
        stageDef.sections,
        (t) => sub(t, key)?.payload.answers ?? {},
        () => ({}),
        fileRef,
      ),
    ];
  }

  const rows = [columns.map((c) => c.header), ...teams.map((t) => columns.map((c) => c.value(t)))];
  // UTF-8 with a byte-order mark, CRLF: what Excel needs to read Thai names.
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
