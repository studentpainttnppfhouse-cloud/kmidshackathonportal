import { canEditPage, isAdmin, type Viewer } from "@/lib/policy";

export function canManageCalendar(viewer: Viewer) {
  return viewer.isActive && !viewer.deletedAt && !viewer.isAlumni &&
    canEditPage(viewer, "calendar") && (isAdmin(viewer) || viewer.tier === "T2_HEAD");
}

export function canEditCalendarEvent(viewer: Viewer, createdById: string) {
  return canManageCalendar(viewer) && (isAdmin(viewer) || viewer.id === createdById);
}
