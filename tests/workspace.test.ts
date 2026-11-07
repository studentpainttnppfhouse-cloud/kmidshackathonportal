import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canReadDrive,
  canEditDrive,
  canReadEntry,
  canEditEntry,
  canAssignPerson,
  bangkokDay,
  validDay,
} from "../src/lib/workspace-policy";
import type { Viewer } from "../src/lib/policy";
const member = {
  id: "member",
  tier: "T1_MEMBER",
  departmentId: "graphics",
  isActive: true,
  deletedAt: null,
  isAlumni: false,
} as Viewer;
const head = { ...member, id: "head", tier: "T2_HEAD" } as Viewer;
const admin = { ...member, id: "admin", tier: "T3_ADMIN" } as Viewer;
const owner = { ...member, id: "owner", tier: "T4_OWNER" } as Viewer;
const privateDoc = {
  ownerId: "member",
  scope: "private",
  departmentId: "graphics",
  sharedUserIds: [],
};
test("private drive items remain private even from heads/admins/owners", () => {
  assert.equal(canReadDrive(member, privateDoc), true);
  for (const v of [head, admin, owner]) {
    assert.equal(canReadDrive(v, privateDoc), false);
    assert.equal(canEditDrive(v, privateDoc), false);
  }
});
test("sharing permits read without granting edit, and revocation removes access", () => {
  const shared = { ...privateDoc, scope: "people", sharedUserIds: ["head"] };
  assert.equal(canReadDrive(head, shared), true);
  assert.equal(canEditDrive(head, shared), false);
  assert.equal(canReadDrive(admin, shared), false);
  assert.equal(canReadDrive(head, { ...shared, sharedUserIds: [] }), false);
  assert.equal(
    canReadDrive(head, { ...privateDoc, scope: "department" }),
    true,
  );
  assert.equal(
    canReadDrive(
      { ...head, departmentId: "other" },
      { ...privateDoc, scope: "department" },
    ),
    false,
  );
});
test("members edit only personal calendar entries; shared meeting editing is role scoped", () => {
  const e = {
    ownerId: member.id,
    scope: "department",
    departmentId: "graphics",
    attendeeIds: [],
  };
  assert.equal(canReadEntry(member, e), true);
  assert.equal(canEditEntry(member, e), false);
  assert.equal(canEditEntry(head, e), true);
  assert.equal(canEditEntry({ ...head, departmentId: "other" }, e), false);
  assert.equal(canEditEntry(admin, e), true);
  assert.equal(canEditEntry(member, { ...e, scope: "private" }), true);
  assert.equal(canReadEntry(admin, { ...e, scope: "private" }), false);
  assert.equal(canEditEntry(admin, { ...e, scope: "private" }), false);
});
test("assignment hierarchy prevents members assigning others and heads crossing teams or assigning peers", () => {
  assert.equal(canAssignPerson(member, head), false);
  assert.equal(canAssignPerson(member, member), true);
  assert.equal(canAssignPerson(head, member), true);
  assert.equal(
    canAssignPerson(head, { ...member, departmentId: "other" }),
    false,
  );
  assert.equal(canAssignPerson(head, { ...head, id: "peer" }), false);
  assert.equal(canAssignPerson(admin, head), true);
  assert.equal(canAssignPerson(admin, owner), false);
});
test("inactive accounts, alumni writes and page restrictions remain enforced", () => {
  assert.equal(canReadDrive({ ...member, isActive: false }, privateDoc), false);
  assert.equal(canEditDrive({ ...member, isAlumni: true }, privateDoc), false);
  assert.equal(
    canReadDrive({ ...member, pageGrants: { documents: "NONE" } }, privateDoc),
    false,
  );
  assert.equal(
    canEditDrive({ ...member, pageGrants: { documents: "READ" } }, privateDoc),
    false,
  );
  const e = {
    ownerId: member.id,
    scope: "private",
    departmentId: null,
    attendeeIds: [],
  };
  assert.equal(
    canEditEntry({ ...member, pageGrants: { calendar: "READ" } }, e),
    false,
  );
  assert.equal(
    canReadEntry({ ...member, pageGrants: { calendar: "NONE" } }, e),
    false,
  );
});
test("Bangkok date boundaries and invalid days", () => {
  assert.equal(bangkokDay(new Date("2027-01-31T18:00:00Z")), "2027-02-01");
  assert.equal(validDay("2027-02-29"), false);
  assert.equal(validDay("2028-02-29"), true);
  assert.equal(validDay("2027-13-01"), false);
});

test("all active members view meetings and every head can edit across departments", () => {
  const meeting = {
    ownerId: member.id,
    departmentId: "other",
    scope: "all",
    kind: "meeting",
    attendeeIds: [],
  };
  assert.equal(canReadEntry(member, meeting), true);
  assert.equal(canEditEntry(member, meeting), false);
  for (const viewer of [head, admin, owner]) {
    assert.equal(canReadEntry(viewer, meeting), true);
    assert.equal(canEditEntry(viewer, meeting), true);
  }
  assert.equal(canEditEntry({ ...head, isAlumni: true }, meeting), false);
  assert.equal(
    canEditEntry({ ...head, pageGrants: { calendar: "READ" } }, meeting),
    false,
  );
  assert.equal(
    canReadEntry({ ...member, pageGrants: { calendar: "NONE" } }, meeting),
    false,
  );
});

test("documents can be shared with multiple departments and named people without making them public", () => {
  const shared = {
    ...privateDoc,
    ownerId: "writer",
    scope: "people",
    sharedUserIds: ["admin"],
    sharedDepartmentIds: ["graphics", "social"],
  };
  assert.equal(canReadDrive(member, shared), true);
  assert.equal(
    canReadDrive({ ...member, departmentId: "social" }, shared),
    true,
  );
  assert.equal(
    canReadDrive({ ...member, departmentId: "operations" }, shared),
    false,
  );
  assert.equal(
    canReadDrive({ ...admin, departmentId: "operations" }, shared),
    true,
  );
  assert.equal(canEditDrive(admin, shared), false);
  assert.equal(
    canReadDrive(member, { ...shared, sharedDepartmentIds: [] }),
    false,
  );
  assert.equal(canReadDrive(admin, { ...shared, scope: "private" }), false);
});
