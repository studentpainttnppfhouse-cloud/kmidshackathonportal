import { atLeast, canEditPage, canSeePage, type Viewer } from "./policy";
import { TIER_ORDER } from "./constants";
import type { Tier } from "@prisma/client";
export const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
type Shared = {
  ownerId: string;
  scope: string;
  departmentId: string | null;
  deletedAt?: Date | null;
};
const active = (v: Viewer) => v.isActive && !v.deletedAt;
const writable = (v: Viewer) =>
  active(v) && !v.isAlumni && atLeast(v, "T1_MEMBER");
export function canReadDrive(
  v: Viewer,
  d: Shared & { sharedUserIds: unknown; sharedDepartmentIds?: unknown },
) {
  return (
    active(v) &&
    !d.deletedAt &&
    canSeePage(v, "documents") &&
    (d.ownerId === v.id ||
      d.scope === "all" ||
      (d.scope === "department" &&
        !!d.departmentId &&
        d.departmentId === v.departmentId) ||
      (d.scope === "people" &&
        (ids(d.sharedUserIds).includes(v.id) ||
          (!!v.departmentId &&
            ids(d.sharedDepartmentIds).includes(v.departmentId)))))
  );
}
export function canEditDrive(v: Viewer, d: Shared) {
  return (
    writable(v) &&
    !d.deletedAt &&
    canEditPage(v, "documents") &&
    d.ownerId === v.id
  );
}
export function canReadEntry(
  v: Viewer,
  e: Shared & { attendeeIds: unknown; kind?: string },
) {
  return (
    active(v) &&
    !e.deletedAt &&
    canSeePage(v, "calendar") &&
    (e.kind === "meeting" ||
      e.ownerId === v.id ||
      (e.scope !== "private" &&
        (atLeast(v, "T3_ADMIN") ||
          (v.tier === "T2_HEAD" &&
            !!e.departmentId &&
            e.departmentId === v.departmentId))) ||
      e.scope === "all" ||
      (e.scope === "department" &&
        !!e.departmentId &&
        e.departmentId === v.departmentId) ||
      ids(e.attendeeIds).includes(v.id))
  );
}
export function canEditEntry(v: Viewer, e: Shared & { kind?: string }) {
  if (!writable(v) || e.deletedAt || !canEditPage(v, "calendar")) return false;
  if (e.kind === "meeting") return atLeast(v, "T2_HEAD");
  if (e.scope === "private") return e.ownerId === v.id;
  return (
    atLeast(v, "T3_ADMIN") ||
    (v.tier === "T2_HEAD" &&
      e.departmentId === v.departmentId &&
      !!e.departmentId)
  );
}
export function canAssignPerson(
  v: Viewer,
  p: { id: string; tier: Tier; departmentId: string | null },
) {
  return (
    p.id === v.id ||
    (writable(v) &&
      atLeast(v, "T2_HEAD") &&
      TIER_ORDER[p.tier] < TIER_ORDER[v.tier] &&
      (atLeast(v, "T3_ADMIN") ||
        (!!v.departmentId && p.departmentId === v.departmentId)))
  );
}
export function bangkokDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function validDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00+07:00")) &&
    bangkokDay(new Date(value + "T00:00:00+07:00")) === value
  );
}
