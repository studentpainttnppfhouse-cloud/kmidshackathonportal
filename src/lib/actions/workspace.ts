"use server";
import { db } from "@/lib/db";
import { requirePageAccess, can, atLeast } from "@/lib/authorize";
import {
  canReadEntry,
  canEditEntry,
  canEditDrive,
  canAssignPerson,
  ids,
  validDay,
} from "@/lib/workspace-policy";
import { readDrive, driveItems } from "@/lib/workspace-access";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { RULES, rateLimit, retryMessage } from "@/lib/rate-limit";
import type { FormState } from "./auth";
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export async function saveEntry(_: FormState, f: FormData): Promise<FormState> {
  const v = await requirePageAccess("calendar", "edit");
  const limit = rateLimit(`write:${v.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };
  if (!v.isActive || v.deletedAt || v.isAlumni || !atLeast(v, "T1_MEMBER"))
    return { error: "Your account is read only." };
  const id = text(f, "id"),
    title = text(f, "title"),
    date = text(f, "date"),
    time = text(f, "time") || "09:00",
    end = text(f, "end");
  const kind = text(f, "kind") || "event";
  const scope = kind === "meeting" ? "all" : text(f, "scope") || "private",
    departmentId = text(f, "departmentId") || null;
  const attendeeIds = [...new Set(f.getAll("attendeeIds").map(String))];
  if (
    title.length < 2 ||
    title.length > 200 ||
    !validDay(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    return { error: "Enter a title, valid date and time." };
  if (
    !["private", "department", "all", "people"].includes(scope) ||
    !["event", "meeting", "post"].includes(kind)
  )
    return { error: "Choose a valid event type and audience." };
  if (text(f, "body").length > 20000 || text(f, "location").length > 200)
    return { error: "Please shorten the notes or location." };
  if (kind === "meeting" && !atLeast(v, "T2_HEAD"))
    return {
      error: "Heads, admins and owners manage meetings. Members can view them.",
    };
  if (scope !== "private" && !atLeast(v, "T2_HEAD"))
    return { error: "Members can create personal events only." };
  if (kind !== "meeting" && scope === "all" && !atLeast(v, "T3_ADMIN"))
    return { error: "Only admins and owners can create portal-wide events." };
  if (scope === "department" && !departmentId)
    return { error: "Choose a team." };
  if (departmentId) {
    if (!(await db.department.findUnique({ where: { id: departmentId } })))
      return { error: "Team not found." };
    if (
      kind !== "meeting" &&
      !atLeast(v, "T3_ADMIN") &&
      departmentId !== v.departmentId
    )
      return { error: "Choose your own team." };
  }
  if (
    kind !== "meeting" &&
    v.tier === "T2_HEAD" &&
    scope !== "private" &&
    departmentId !== v.departmentId
  )
    return { error: "Heads create shared events within their own team." };
  if (scope === "private" && attendeeIds.some((x) => x !== v.id))
    return { error: "Personal events cannot be assigned to other people." };
  const people = await db.user.findMany({
    where: { id: { in: attendeeIds }, isActive: true, deletedAt: null },
  });
  if (
    people.length !== attendeeIds.length ||
    (kind !== "meeting" && people.some((p) => !canAssignPerson(v, p)))
  )
    return {
      error:
        "You can assign yourself or lower-tier people within your permitted teams.",
    };
  if (scope === "people" && !attendeeIds.length)
    return { error: "Choose at least one attendee." };
  if (id) {
    const old = await db.calendarEntry.findUnique({ where: { id } });
    if (!old || !canEditEntry(v, old))
      return { error: "You cannot edit this event." };
  }
  const startsAt = new Date(`${date}T${time}:00+07:00`);
  let endsAt: Date | null = null;
  if (end) {
    if (
      !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
      !validDay(end.slice(0, 10))
    )
      return { error: "Choose a valid end time." };
    endsAt = new Date(end + ":00+07:00");
    if (endsAt <= startsAt) return { error: "End must be after start." };
  }
  const teamNextSteps: Record<string, string> = {};
  if (kind === "meeting") {
    const teams = await db.department.findMany({ select: { id: true } });
    for (const team of teams) {
      const note = text(f, `team-${team.id}`);
      if (note.length > 2000)
        return { error: "Team next steps must be under 2,000 characters." };
      if (note) teamNextSteps[team.id] = note;
    }
  }
  const data = {
    title,
    ...(kind === "meeting" ? { teamNextSteps } : {}),
    allDay: f.get("allDay") === "on",
    summary: text(f, "summary").slice(0, 5000),
    nextSteps: text(f, "nextSteps").slice(0, 5000),
    body: text(f, "body"),
    startsAt,
    endsAt,
    scope,
    kind,
    departmentId,
    attendeeIds,
    location: text(f, "location"),
  };
  const row = id
    ? await db.calendarEntry.update({ where: { id }, data })
    : await db.calendarEntry.create({ data: { ...data, ownerId: v.id } });
  await audit(v.id, id ? "calendar.updated" : "calendar.created", {
    type: "calendar",
    id: row.id,
  });
  revalidatePath("/calendar");
  revalidatePath("/meetings");
  revalidatePath(`/calendar/${row.id}`);
  revalidatePath(`/meetings/${row.id}`);
  redirect(
    row.kind === "meeting" ? `/meetings/${row.id}` : `/calendar/${row.id}`,
  );
}
export async function removeEntry(id: string) {
  const v = await requirePageAccess("calendar", "edit");
  const e = await db.calendarEntry.findUnique({ where: { id } });
  if (!e || !canEditEntry(v, e)) throw new Error("Not allowed");
  await db.calendarEntry.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await audit(v.id, "calendar.deleted", { type: "calendar", id });
  revalidatePath("/calendar");
  revalidatePath("/meetings");
  redirect(e.kind === "meeting" ? "/meetings" : "/calendar");
}
export async function saveDrive(_: FormState, f: FormData): Promise<FormState> {
  const v = await requirePageAccess("documents", "edit");
  const limit = rateLimit(`write:${v.id}`, RULES.write);
  if (!limit.ok) return { error: retryMessage(limit.retryAfter) };
  if (!v.isActive || v.deletedAt || v.isAlumni || !atLeast(v, "T1_MEMBER"))
    return { error: "Your account is read only." };
  const id = text(f, "id"),
    title = text(f, "title"),
    body = text(f, "body"),
    scope = text(f, "scope") || "private",
    kind = text(f, "kind") || "document",
    departmentId = text(f, "departmentId") || null;
  const sharedUserIds = [...new Set(f.getAll("sharedUserIds").map(String))];
  if (title.length < 2 || title.length > 200 || body.length > 400000)
    return {
      error:
        "Enter a title of 2–200 characters and a document under 400,000 characters.",
    };
  if (
    !["private", "department", "people", "all"].includes(scope) ||
    !["document", "folder"].includes(kind)
  )
    return { error: "Choose a valid sharing option." };
  const sharedDepartmentIds = [
    ...new Set(f.getAll("sharedDepartmentIds").map(String)),
  ];
  const sharing = await validateDriveSharing(
    scope,
    sharedUserIds,
    sharedDepartmentIds,
    departmentId,
  );
  if (sharing.error) return sharing;
  if (id) {
    const old = await db.driveItem.findUnique({ where: { id } });
    if (!old || !canEditDrive(v, old))
      return { error: "Only the owner can edit or share this item." };
  }
  const data = {
    title,
    body,
    scope,
    kind,
    departmentId,
    sharedUserIds,
    sharedDepartmentIds,
  };
  const row = id
    ? await db.driveItem.update({ where: { id }, data })
    : await db.driveItem.create({ data: { ...data, ownerId: v.id } });
  await audit(v.id, id ? "drive.updated" : "drive.created", {
    type: "drive",
    id: row.id,
  });
  revalidatePath("/drive");
  revalidatePath(`/drive/${row.id}`);
  redirect(`/drive/${row.id}`);
}
async function validateDriveSharing(
  scope: string,
  userIds: string[],
  departmentIds: string[],
  departmentId: string | null,
): Promise<FormState> {
  if (!["private", "people", "department", "all"].includes(scope))
    return { error: "Choose a sharing option." };
  if (userIds.length > 500 || departmentIds.length > 50)
    return { error: "Too many recipients." };
  if (scope === "people" && !userIds.length && !departmentIds.length)
    return { error: "Choose at least one person or team." };
  if (scope === "department" && !departmentId)
    return { error: "Choose a department." };
  const teamIds = [
    ...new Set([...departmentIds, ...(departmentId ? [departmentId] : [])]),
  ];
  const [users, teams] = await Promise.all([
    db.user.count({
      where: { id: { in: userIds }, isActive: true, deletedAt: null },
    }),
    db.department.count({ where: { id: { in: teamIds } } }),
  ]);
  return users === userIds.length && teams === teamIds.length
    ? {}
    : { error: "A recipient is no longer available. Reload and choose again." };
}

export async function shareDrive(
  id: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const viewer = await requirePageAccess("documents", "edit");
  const item = await db.driveItem.findUnique({ where: { id } });
  if (!item || !canEditDrive(viewer, item))
    return { error: "Only the owner can share this document." };
  const scope = text(form, "scope");
  const sharedUserIds = [...new Set(form.getAll("sharedUserIds").map(String))];
  const sharedDepartmentIds = [
    ...new Set(form.getAll("sharedDepartmentIds").map(String)),
  ];
  const validation = await validateDriveSharing(
    scope,
    sharedUserIds,
    sharedDepartmentIds,
    null,
  );
  if (validation.error) return validation;
  await db.driveItem.update({
    where: { id },
    data: {
      scope,
      departmentId: null,
      sharedUserIds: scope === "people" ? sharedUserIds : [],
      sharedDepartmentIds: scope === "people" ? sharedDepartmentIds : [],
    },
  });
  await audit(viewer.id, "drive.shared", { type: "drive", id });
  revalidatePath("/drive");
  revalidatePath(`/drive/${id}`);
  return { ok: "Sharing updated." };
}

export async function recordDriveOpen(id: string): Promise<void> {
  const viewer = await requirePageAccess("documents");
  const item = await db.driveItem.findUnique({ where: { id } });
  if (!item || !(await readDrive(viewer, item))) return;
  await db.driveVisit.upsert({
    where: { itemId_userId: { itemId: id, userId: viewer.id } },
    create: { itemId: id, userId: viewer.id },
    update: { openedAt: new Date() },
  });
  revalidatePath("/drive");
}

export async function listDriveChoices() {
  const v = await requirePageAccess("documents");
  return (await driveItems(v))
    .filter((x) => canEditDrive(v, x))
    .map((x) => ({ id: x.id, title: x.title }));
}
export async function submitDrive(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const v = await requirePageAccess("assignments", "edit");
  const itemId = text(f, "itemId"),
    assignmentId = text(f, "assignmentId");
  const [d, a] = await Promise.all([
    db.driveItem.findUnique({ where: { id: itemId } }),
    db.assignment.findUnique({
      where: { id: assignmentId },
      include: { assignees: true },
    }),
  ]);
  if (
    !d ||
    !canEditDrive(v, d) ||
    !(await readDrive(v, d)) ||
    !a ||
    a.deletedAt ||
    !can(v, "update", {
      kind: "assignment",
      departmentId: a.departmentId,
      createdById: a.createdById,
      ownerIds: a.assignees.map((x) => x.userId),
    })
  )
    return {
      error: "You can submit your own drive items to tasks you can edit.",
    };
  await db.driveSubmission.upsert({
    where: { itemId_assignmentId: { itemId, assignmentId } },
    create: { itemId, assignmentId, submittedById: v.id },
    update: {},
  });
  await audit(v.id, "drive.submitted", {
    type: "assignment",
    id: assignmentId,
    detail: itemId,
  });
  revalidatePath(`/assignments/${assignmentId}`);
  return {
    ok: "Drive item attached. The task owners and supervisors can read it.",
  };
}

/** Import a proposed posting plan; never queues anything on Instagram. */
export async function importPostingCalendar(
  _: FormState,
  f: FormData,
): Promise<FormState> {
  const v = await requirePageAccess("calendar", "edit");
  if (!atLeast(v, "T3_ADMIN") || v.isAlumni)
    return {
      error: "Only admins and owners can import a shared posting plan.",
    };
  const file = f.get("calendar");
  if (!(file instanceof File) || file.size > 250000)
    return { error: "Choose a posting-calendar JSON file under 250 KB." };
  let rows: unknown;
  try {
    rows = JSON.parse(await file.text());
  } catch {
    return { error: "That file is not valid JSON." };
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 200)
    return { error: "Provide between 1 and 200 posts." };
  const parsed: {
    title: string;
    date: string;
    time: string;
    owner: string;
    id: string;
  }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return { error: "Invalid post." };
    const r = row as Record<string, unknown>;
    if (
      typeof r.title !== "string" ||
      r.title.length < 2 ||
      r.title.length > 200 ||
      typeof r.date !== "string" ||
      !validDay(r.date) ||
      typeof r.time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ||
      typeof r.id !== "string" ||
      r.id.length > 40 ||
      typeof r.owner !== "string" ||
      r.owner.length > 100
    )
      return {
        error:
          "Each post needs id, title, date (YYYY-MM-DD), time (HH:mm) and owner.",
      };
    parsed.push({
      title: r.title,
      date: r.date,
      time: r.time,
      id: r.id,
      owner: r.owner,
    });
  }
  const { createHash } = await import("node:crypto");
  // Deterministic ids make retries safe, including simultaneous submissions.
  for (const p of parsed) {
    const id =
      "post_" +
      createHash("sha256")
        .update(v.id + "|" + p.id + "|" + p.date)
        .digest("hex")
        .slice(0, 30);
    const data = {
      title: p.title,
      startsAt: new Date(`${p.date}T${p.time}:00+07:00`),
      kind: "post",
      scope: "all",
      ownerId: v.id,
      body: `Proposed Instagram post · ${p.id}\nProduction owner: ${p.owner}\nArtwork and release details must be approved before publishing. This entry does not schedule a live Instagram post.`,
    };
    await db.calendarEntry.upsert({
      where: { id },
      create: { id, ...data },
      update: { ...data, deletedAt: null },
    });
  }
  await audit(v.id, "calendar.imported", {
    type: "calendar",
    detail: `${parsed.length} proposed Instagram posts`,
  });
  revalidatePath("/calendar");
  return {
    ok: `${parsed.length} proposed posts imported. Nothing was published to Instagram.`,
  };
}
