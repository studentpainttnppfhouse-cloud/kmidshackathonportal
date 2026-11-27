/**
 * The 2027 competition forms, against the acceptance checks in the forms plan
 * (section 13). Everything here runs without a database: the validator, the
 * permission rules and the CSV layout are pure on purpose so they can be
 * pinned down like this.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTemplate } from "../src/lib/competition/templates";
import {
  checkCompetitionDefinition,
  competitionDefinitionSchema,
  durationSeconds,
  expandSection,
  fileSafeName,
  namingFor,
  normalizeDriveFolder,
  parseSettings,
  teamCode,
  unresolvedSettings,
  validateQuestions,
  type CSection,
} from "../src/lib/competition/schema";
import { buildCompetitionCsv, type ExportTeam } from "../src/lib/competition/export";
import { canCompetition, type Viewer } from "../src/lib/policy";
import type { Tier } from "@prisma/client";

const internal = buildTemplate("internal");
const external = buildTemplate("external");
const MB = 10 * 1024 * 1024;

const pdf = (name = "doc.pdf") => new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

/** A complete, valid internal registration for `members` people. */
function internalForm(members: number, extra: (fd: FormData) => void = () => {}): FormData {
  const fd = new FormData();
  fd.set("c_I-A01", "Yes");
  fd.set("c_I-A02", "Yes");
  fd.set("c_I-A03", "CareBridge");
  fd.set("c_I-A04", String(members));
  for (let n = 1; n <= 4; n += 1) {
    // Always fill four, as a browser would after the count was lowered.
    fd.set(`c_I-C${n}-01`, `Student ${n}`);
    fd.set(`c_I-C${n}-03`, "11");
    fd.set(`c_I-C${n}-04`, "11/2");
    fd.set(`c_I-C${n}-05`, `s${n}@kmids.ac.th`);
  }
  for (let i = 1; i <= 9; i += 1) fd.set(`c_I-D0${i}`, "yes");
  extra(fd);
  return fd;
}

function externalForm(extra: (fd: FormData) => void = () => {}): FormData {
  const fd = new FormData();
  fd.set("c_E-A01", "Yes");
  fd.set("c_E-A02", "No");
  fd.set("c_E-A03", "Yes");
  fd.set("c_E-A04", "HealthLink");
  fd.set("c_E-A05", "2");
  fd.set("c_E-B01", "Not yet");
  for (let n = 1; n <= 2; n += 1) {
    fd.set(`c_E-C${n}-01`, `ผู้เข้าแข่งขัน ${n}`);
    fd.set(`c_E-C${n}-03`, n === 1 ? "School A" : "School B");
    fd.set(`c_E-C${n}-04`, "M.5");
    fd.set(`c_E-C${n}-05`, `p${n}@example.com`);
    fd.set(`c_E-C${n}-06`, pdf());
    fd.set(`c_E-C${n}-07`, pdf());
  }
  for (let i = 1; i <= 9; i += 1) fd.set(`c_E-D0${i}`, "yes");
  fd.set("c_E-E01", "Parent Name");
  fd.set("c_E-E02", "599");
  fd.set("c_E-E03", "2026-12-12");
  fd.set("c_E-E04", "14:05");
  fd.set("c_E-E06__link", "https://example.com/receipt/123");
  fd.set("c_E-E07", "yes");
  extra(fd);
  return fd;
}

const register = (sections: CSection[], fd: FormData) => validateQuestions(sections, fd, { members: null, maxBytes: MB });

// ---------------------------------------------------------------------------

test("both templates are valid definitions, with G gone and H written out", () => {
  for (const d of [internal, external]) {
    assert.equal(competitionDefinitionSchema.safeParse(d).success, true);
    assert.equal(checkCompetitionDefinition(d), null);
    assert.ok(!JSON.stringify(d).includes('"key":"G"'));
    assert.equal(d.h.key, "H");
  }
});

test("internal goes A, C, D and external goes A, B, C, D, E; D appears once", () => {
  assert.deepEqual(internal.sections.map((s) => s.key), ["A", "C", "D"]);
  assert.deepEqual(external.sections.map((s) => s.key), ["A", "B", "C", "D", "E"]);
  for (const d of [internal, external]) {
    const dSection = d.sections.find((s) => s.key === "D")!;
    assert.equal(dSection.memberQuestions, undefined);
    assert.equal(expandSection(dSection, 4).length, 9);
  }
});

test("member counts 1 to 4 render exactly that many member blocks", () => {
  const c = internal.sections.find((s) => s.key === "C")!;
  for (let n = 1; n <= 4; n += 1) {
    const blocks = new Set(expandSection(c, n).filter((q) => q.member).map((q) => q.member));
    assert.equal(blocks.size, n);
  }
});

test("a solo team registers, and lowering 4 to 1 drops members 2 to 4 entirely", () => {
  const result = register(internal.sections, internalForm(1));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.memberCount, 1);
  assert.ok(result.answers["I-C1-01"]);
  assert.equal(result.answers["I-C2-01"], undefined);
  assert.deepEqual(result.files, {});
});

test("a missing member is refused; external teams must send an ID and a ปพ.7", () => {
  const two = internalForm(2, (fd) => fd.delete("c_I-C2-01"));
  assert.equal(register(internal.sections, two).ok, false);
  const noId = externalForm((fd) => fd.delete("c_E-C1-06"));
  assert.equal(register(external.sections, noId).ok, false);
  const noPp7 = externalForm((fd) => fd.delete("c_E-C2-07"));
  assert.equal(register(external.sections, noPp7).ok, false);
});

test("internal teams are not asked for documents, but an admin can switch them on", () => {
  const c = internal.sections.find((s) => s.key === "C")!;
  assert.equal(expandSection(c, 4).some((q) => q.type === "document"), false);
  const edited = structuredClone(internal);
  for (const q of edited.sections.find((s) => s.key === "C")!.memberQuestions!) {
    if (q.type === "document") q.enabled = true;
  }
  assert.equal(register(edited.sections, internalForm(1)).ok, false);
});

test("eligibility answers stop the form", () => {
  const notKmids = register(internal.sections, internalForm(1, (fd) => fd.set("c_I-A01", "No")));
  assert.equal(notKmids.ok, false);
  const mixed = register(external.sections, externalForm((fd) => fd.set("c_E-A02", "Yes")));
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.match(mixed.error, /KMIDS/);
});

test("external mixed-school team registers; supervisor questions only when B01 is Yes", () => {
  const ok = register(external.sections, externalForm());
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.answers["E-C2-03"], "School B");

  const yesNoName = register(external.sections, externalForm((fd) => fd.set("c_E-B01", "Yes")));
  assert.equal(yesNoName.ok, false);

  const stale = register(
    external.sections,
    externalForm((fd) => {
      fd.set("c_E-B01", "Not yet");
      fd.set("c_E-B02", "Left over");
    }),
  );
  assert.equal(stale.ok, true);
  if (stale.ok) assert.equal(stale.answers["E-B02"], undefined);
});

test("payment proof: one of upload or link, and an unexpected amount is flagged", () => {
  const none = register(external.sections, externalForm((fd) => fd.delete("c_E-E06__link")));
  assert.equal(none.ok, false);
  const both = register(external.sections, externalForm((fd) => fd.set("c_E-E06", pdf("slip.pdf"))));
  assert.equal(both.ok, false);
  const upload = register(
    external.sections,
    externalForm((fd) => {
      fd.delete("c_E-E06__link");
      fd.set("c_E-E06", new File([new Uint8Array([1, 2, 3])], "slip.heic", { type: "image/heic" }));
    }),
  );
  assert.equal(upload.ok, true);
  const http = register(external.sections, externalForm((fd) => fd.set("c_E-E06__link", "http://example.com")));
  assert.equal(http.ok, false);
  const wrong = register(external.sections, externalForm((fd) => fd.set("c_E-E02", "500")));
  assert.equal(wrong.ok, true);
  if (wrong.ok) assert.equal(wrong.flags.length, 1);
});

test("an executable is not a document", () => {
  const exe = register(
    external.sections,
    externalForm((fd) => fd.set("c_E-C1-06", new File([new Uint8Array([1])], "id.exe"))),
  );
  assert.equal(exe.ok, false);
});

test("stage F takes one Drive folder link and a video of at most 04:00", () => {
  const f = (folder: string, length = "03:59") => {
    const fd = new FormData();
    fd.set("c_I-F03", "CareBridge");
    fd.set("c_I-F04", "Thai");
    fd.set("c_I-F05", folder);
    fd.set("c_I-F06", length);
    for (const n of ["07", "08", "09", "10"]) fd.set(`c_I-F${n}`, "yes");
    return validateQuestions(internal.f.sections, fd, { members: 2, maxBytes: MB });
  };
  const good = f("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing");
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.answers["I-F05"], "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp");
  assert.equal(f("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view").ok, false);
  assert.equal(f("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp").ok, false);
  assert.equal(f("http://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp").ok, false);
  assert.equal(f("https://drive.google.com.evil.example/drive/folders/1AbCdEfGhIjKlMnOp").ok, false);
  assert.equal(f("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", "04:01").ok, false);
  assert.equal(f("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", "04:00").ok, true);
  // No G essays, no extra uploads.
  const ids = internal.f.sections.flatMap((s) => s.questions.map((q) => q.type));
  assert.ok(!ids.includes("document") && !ids.includes("proof"));
});

test("drive folder links keep a resource key and drop everything else", () => {
  assert.equal(
    normalizeDriveFolder("https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOp?resourcekey=0-abc&x=1"),
    "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?resourcekey=0-abc",
  );
  assert.equal(durationSeconds("3:45"), 225);
  assert.equal(durationSeconds("3.45"), null);
});

test("team IDs pad to two digits and never cap there", () => {
  assert.equal(teamCode("internal", 1), "internal01");
  assert.equal(teamCode("external", 99), "external99");
  assert.equal(teamCode("external", 100), "external100");
});

test("folder and file names come from the saved team", () => {
  assert.equal(fileSafeName('Care Bridge: v2?'), "Care_Bridge_v2");
  const names = namingFor("internal01", "CareBridge");
  assert.equal(names.folder, "internal01_CareBridge_Round1_2027");
  assert.equal(names.video, "internal01_CareBridge_VideoPitch.mp4");
  assert.equal(names.brief, "internal01_CareBridge_ImpactBrief.pdf");
});

test("publishing stays blocked until the organizer decides, and nothing is guessed", () => {
  const empty = parseSettings({});
  const none = { opensAt: null, closesAt: null };
  const internalIssues = unresolvedSettings("internal", empty, none).filter((i) => i.blocksPublish).map((i) => i.key);
  assert.ok(internalIssues.includes("internalDeadlineConfirmed"));
  assert.ok(!internalIssues.includes("payeeName"));
  const externalIssues = unresolvedSettings("external", empty, none).filter((i) => i.blocksPublish).map((i) => i.key);
  for (const key of ["payeeName", "paymentMethod", "refundPolicy", "capacity", "rulesUrl", "privacyUrl"]) {
    assert.ok(externalIssues.includes(key), key);
  }
  const ready = parseSettings({
    rulesUrl: "https://example.com/rules",
    privacyUrl: "https://example.com/privacy",
    reviewerAccess: "anyone_with_link",
    closeTimeConfirmed: true,
    internalDeadlineConfirmed: true,
  });
  const times = { opensAt: new Date(), closesAt: new Date() };
  assert.equal(unresolvedSettings("internal", ready, times).filter((i) => i.blocksPublish).length, 0);
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

function user(tier: Tier, overrides: Partial<Viewer> = {}): Viewer {
  return {
    id: `u-${tier}`,
    email: `${tier}@kmids.ac.th`,
    tier,
    departmentId: "dept",
    isReserve: false,
    isAlumni: false,
    isActive: true,
    deletedAt: null,
    department: null,
    ...overrides,
  } as Viewer;
}

test("T4, T3 and T2 see and export; T1, T0 and nobody do not", () => {
  for (const tier of ["T4_OWNER", "T3_ADMIN", "T2_HEAD"] as Tier[]) {
    assert.equal(canCompetition(user(tier), "view"), true, tier);
    assert.equal(canCompetition(user(tier), "export"), true, tier);
    assert.equal(canCompetition(user(tier), "review"), true, tier);
  }
  for (const tier of ["T1_MEMBER", "T0_ADVISOR"] as Tier[]) {
    for (const op of ["view", "export", "review", "edit", "publish", "view_identity"] as const) {
      assert.equal(canCompetition(user(tier), op), false, `${tier} ${op}`);
    }
  }
  assert.equal(canCompetition(null, "view"), false);
});

test("only admins edit and open identity documents; only the owner publishes unless delegated", () => {
  assert.equal(canCompetition(user("T2_HEAD"), "edit"), false);
  assert.equal(canCompetition(user("T2_HEAD"), "view_identity"), false);
  assert.equal(canCompetition(user("T3_ADMIN"), "edit"), true);
  assert.equal(canCompetition(user("T3_ADMIN"), "view_identity"), true);
  assert.equal(canCompetition(user("T3_ADMIN"), "publish"), false);
  assert.equal(canCompetition(user("T3_ADMIN"), "publish", { publishDelegatedToAdmins: true }), true);
  assert.equal(canCompetition(user("T2_HEAD"), "publish", { publishDelegatedToAdmins: true }), false);
  assert.equal(canCompetition(user("T4_OWNER"), "publish"), true);
  assert.equal(canCompetition(user("T3_ADMIN"), "correct"), false);
  assert.equal(canCompetition(user("T4_OWNER"), "correct"), true);
});

test("inactive, alumni and page-grid restrictions still apply", () => {
  assert.equal(canCompetition(user("T4_OWNER", { isActive: false }), "view"), false);
  assert.equal(canCompetition(user("T3_ADMIN", { isAlumni: true }), "view"), false);
  assert.equal(canCompetition(user("T3_ADMIN", { pageGrants: { forms: "NONE" } }), "view"), false);
  assert.equal(canCompetition(user("T3_ADMIN", { pageGrants: { forms: "READ" } }), "edit"), false);
  assert.equal(canCompetition(user("T3_ADMIN", { pageGrants: { forms: "READ" } }), "export"), true);
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function team(overrides: Partial<ExportTeam> = {}): ExportTeam {
  return {
    teamCode: "external01",
    teamName: "=HYPERLINK(\"x\")",
    track: "external",
    memberCount: 2,
    representativeEmail: "p1@example.com",
    registeredAt: new Date("2026-12-11T03:00:00Z"),
    registrationStatus: "registered",
    paymentStatus: "pending",
    paymentFlag: null,
    accessChecked: false,
    finalist: false,
    schemaVersion: 1,
    registration: {
      answers: { "E-C1-01": "ผู้เข้าแข่งขัน 1", "E-C2-01": "Two" },
      files: { "E-C1-06": "file-id", "E-E06": "slip-id" },
    },
    submissions: [],
    ...overrides,
  };
}

test("CSV: BOM, Bangkok time, blank unused members, protected files and formulas", () => {
  const csv = buildCompetitionCsv(external, "registration", [team()], (id) =>
    id === "file-id" ? { name: "id.pdf", url: null } : { name: "slip.jpg", url: "https://portal/api/attachments/slip-id" },
  );
  assert.ok(csv.startsWith("﻿"));
  const [header, row] = csv.slice(1).trim().split("\r\n");
  const cols = header.split('","').map((c) => c.replace(/^"|"$/g, ""));
  const cells = row.split('","').map((c) => c.replace(/^"|"$/g, ""));
  const at = (name: string) => cells[cols.findIndex((c) => c.startsWith(name))];
  assert.equal(at("Team ID"), "external01");
  assert.equal(at("Registered"), "2026-12-11 10:00:00 +07:00");
  assert.equal(at("Member 1: E-C1-01"), "ผู้เข้าแข่งขัน 1");
  assert.equal(at("Member 3: E-C3-01"), "");
  assert.equal(at("Member 1: E-C1-06"), "id.pdf (restricted)");
  assert.match(at("E-E06"), /slip\.jpg \(https:/);
  assert.ok(row.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(!csv.includes("continuation"));
});

test("CSV for Round 1 has the stage's questions and no registration uploads", () => {
  const csv = buildCompetitionCsv(
    external,
    "F",
    [
      team({
        submissions: [
          {
            stage: "F",
            status: "final",
            reference: "R1-EXTERNAL01-ABCDEF",
            finalizedAt: new Date("2027-02-14T16:00:00Z"),
            archiveStatus: "not_archived",
            archivedAt: null,
            archiveNote: null,
            schemaVersion: 1,
            payload: { answers: { "E-F05": "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp" } },
          },
        ],
      }),
    ],
    () => null,
  );
  assert.ok(csv.includes("R1-EXTERNAL01-ABCDEF"));
  assert.ok(csv.includes("2027-02-14 23:00:00 +07:00"));
  assert.ok(csv.includes("drive.google.com/drive/folders"));
  assert.ok(!csv.includes("E-C1-06"));
});
