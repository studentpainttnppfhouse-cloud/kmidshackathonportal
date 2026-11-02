"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireViewer, isAdmin } from "@/lib/authorize";
import type { FormState } from "@/lib/actions/auth";
import type { Viewer } from "@/lib/policy";

/** Heads and admins run the staff calendar. Read-only accounts never do. */
function mayAddEvents(v: Viewer): boolean {
  if (!v.isActive || v.deletedAt || v.isAlumni) return false;
  return isAdmin(v) || v.tier === "T2_HEAD";
}

const schema = z.object({
  title: z.string().trim().min(1, "Give the event a title.").max(191),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  start: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  end: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  location: z.string().trim().max(191).optional(),
  notes: z.string().trim().max(5000).optional(),
  departmentId: z.string().max(191).optional(),
});

export async function createCalendarEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  if (!mayAddEvents(viewer)) return { error: "Only heads and admins can add calendar events." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;

  // Heads post for everyone or for their own team. Admins post for any team.
  let departmentId: string | null = d.departmentId || null;
  if (departmentId) {
    if (!isAdmin(viewer) && departmentId !== viewer.departmentId) {
      return { error: "Heads can only add events for their own team or for all staff." };
    }
    const exists = await db.department.findUnique({ where: { id: departmentId }, select: { id: true } });
    if (!exists) departmentId = null;
  }

  const allDay = !d.start;
  const startsAt = new Date(`${d.date}T${d.start || "00:00"}:00+07:00`);
  const endsAt = d.end && d.start ? new Date(`${d.date}T${d.end}:00+07:00`) : null;
  if (Number.isNaN(startsAt.getTime())) return { error: "That date does not look right." };
  if (endsAt && endsAt < startsAt) return { error: "The end time is before the start." };

  const created = await db.calendarEvent.create({
    data: {
      title: d.title,
      notes: d.notes || null,
      location: d.location || null,
      startsAt,
      endsAt,
      allDay,
      departmentId,
      createdById: viewer.id,
    },
  });
  await audit(viewer.id, "calendar.created", { type: "calendar_event", id: created.id, detail: d.title });
  revalidatePath("/calendar");
  return { ok: "Event added." };
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const viewer = await requireViewer();
  const ev = await db.calendarEvent.findUnique({ where: { id } });
  if (!ev || !mayAddEvents(viewer)) return;
  if (!isAdmin(viewer) && ev.createdById !== viewer.id) return;
  await db.calendarEvent.delete({ where: { id } });
  await audit(viewer.id, "calendar.deleted", { type: "calendar_event", id, detail: ev.title });
  revalidatePath("/calendar");
}
