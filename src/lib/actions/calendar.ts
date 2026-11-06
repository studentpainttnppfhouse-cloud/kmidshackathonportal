"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireViewer, isAdmin } from "@/lib/authorize";
import { optionalUrlSchema } from "@/lib/url";
import type { FormState } from "@/lib/actions/auth";
import { canManageCalendar, canEditCalendarEvent } from "@/lib/calendar-access";

const schema = z.object({
  title: z.string().trim().min(1, "Give the event a title.").max(191),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal("")),
  end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal("")),
  location: z.string().trim().max(191).optional(),
  notes: z.string().trim().max(5000).optional(),
  departmentId: z.string().max(191).optional(),
  id: z.string().max(40).optional(),
  isMeeting: z.literal("on").optional(),
  slidesUrl: optionalUrlSchema,
  summary: z.string().trim().max(5000).optional(),
  nextSteps: z.string().trim().max(5000).optional(),
});

export async function createCalendarEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireViewer();
  if (!canManageCalendar(viewer)) return { error: "Only heads and admins can add calendar events." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;

  const existing = d.id ? await db.calendarEvent.findUnique({ where: { id: d.id } }) : null;
  if (d.id && (!existing || !canEditCalendarEvent(viewer, existing.createdById))) {
    return { error: "You cannot edit this meeting." };
  }
  const isMeeting = Boolean(d.isMeeting || existing?.isMeeting);
  const teamNextSteps: Record<string, string> = {};
  if (isMeeting) {
    const teams = await db.department.findMany({ select: { id: true } });
    for (const { id } of teams) {
      const note = String(formData.get(`team-${id}`) ?? "").trim();
      if (note.length > 2000) return { error: "Each team’s next steps must be under 2,000 characters." };
      if (note) teamNextSteps[id] = note;
    }
  }

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
  if (Number.isNaN(startsAt.getTime()) || new Date(startsAt.getTime() + 25200000).toISOString().slice(0, 10) !== d.date ||
      (endsAt && Number.isNaN(endsAt.getTime()))) return { error: "That date does not look right." };
  if (endsAt && endsAt < startsAt) return { error: "The end time is before the start." };

  const data = {
    title: d.title,
    notes: d.notes || null,
    location: d.location || null,
    startsAt,
    endsAt,
    allDay,
    departmentId,
    isMeeting,
    slidesUrl: isMeeting ? d.slidesUrl || null : null,
    summary: isMeeting ? d.summary || null : null,
    nextSteps: isMeeting ? d.nextSteps || null : null,
    ...(isMeeting ? { teamNextSteps } : {}),
  };
  const saved = existing
    ? await db.calendarEvent.update({ where: { id: existing.id }, data })
    : await db.calendarEvent.create({ data: { ...data, createdById: viewer.id } });
  await audit(viewer.id, existing ? "calendar.updated" : "calendar.created",
    { type: "calendar_event", id: saved.id, detail: d.title });
  revalidatePath("/calendar");
  return { ok: existing ? "Meeting saved." : isMeeting ? "Meeting added." : "Event added." };
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const viewer = await requireViewer();
  const ev = await db.calendarEvent.findUnique({ where: { id } });
  if (!ev || !canEditCalendarEvent(viewer, ev.createdById)) return;
  await db.calendarEvent.delete({ where: { id } });
  await audit(viewer.id, "calendar.deleted", { type: "calendar_event", id, detail: ev.title });
  revalidatePath("/calendar");
}
