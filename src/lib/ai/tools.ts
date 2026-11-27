import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, isAdmin, type Viewer } from "@/lib/authorize";
import { canCompetition } from "@/lib/policy";
import { searchPortal } from "@/lib/search";
import type { FormState } from "@/lib/actions/auth";
import { createAssignment, updateAssignment } from "@/lib/actions/assignments";
import { createAnnouncement, createDocument } from "@/lib/actions/content";

/**
 * The assistant's tools.
 *
 * Every tool runs as the signed-in person. Writes go through the very same
 * server actions the forms use, so `assertCan()`, the page grid and the rate
 * limits all apply unchanged; reads filter through `can()`. Nothing here may
 * use a service account or skip a check.
 */

type Schema = {
  type: "OBJECT" | "STRING" | "INTEGER" | "BOOLEAN" | "ARRAY";
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: string[];
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: Schema;
  /** Writes are held for the person to confirm in the UI before they run. */
  write: boolean;
};

const STATUSES = ["NOT_STARTED", "IN_PROGRESS", "NEEDS_REVIEW", "APPROVED", "DONE"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export const TOOLS: ToolDef[] = [
  {
    name: "list_departments",
    description: "List departments with their ids. Use to find a departmentId.",
    parameters: { type: "OBJECT", properties: {} },
    write: false,
  },
  {
    name: "list_assignments",
    description: "List tasks (assignments). Optional filters.",
    parameters: {
      type: "OBJECT",
      properties: {
        departmentId: { type: "STRING" },
        status: { type: "STRING", enum: STATUSES },
        mine: { type: "BOOLEAN", description: "Only tasks assigned to me" },
        limit: { type: "INTEGER" },
      },
    },
    write: false,
  },
  {
    name: "create_assignment",
    description: "Create a task. dueDate is YYYY-MM-DD. assigneeIds are user ids from list_people.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        description: { type: "STRING", description: "Markdown: **bold**, *italic*, ++underline++, ~~strike~~, ^sup^, ~sub~, # heading, - list" },
        departmentId: { type: "STRING" },
        dueDate: { type: "STRING" },
        priority: { type: "STRING", enum: PRIORITIES },
        status: { type: "STRING", enum: STATUSES },
        assigneeIds: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["title", "departmentId"],
    },
    write: true,
  },
  {
    name: "update_assignment",
    description: "Update an existing task. Only pass the fields that change.",
    parameters: {
      type: "OBJECT",
      properties: {
        id: { type: "STRING" },
        title: { type: "STRING" },
        description: { type: "STRING" },
        dueDate: { type: "STRING" },
        priority: { type: "STRING", enum: PRIORITIES },
        status: { type: "STRING", enum: STATUSES },
        assigneeIds: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["id"],
    },
    write: true,
  },
  {
    name: "create_announcement",
    description: "Post an announcement. scope 'all' is portal-wide, 'department' needs departmentId.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        body: { type: "STRING" },
        scope: { type: "STRING", enum: ["all", "department"] },
        departmentId: { type: "STRING" },
        pinned: { type: "BOOLEAN" },
      },
      required: ["title", "body", "scope"],
    },
    write: true,
  },
  {
    name: "list_people",
    description: "List people in the portal (id, name, department, tier).",
    parameters: {
      type: "OBJECT",
      properties: { departmentId: { type: "STRING" }, query: { type: "STRING" } },
    },
    write: false,
  },
  {
    name: "search",
    description: "Search the whole portal: tasks, documents, files, people, announcements, forms.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] },
    write: false,
  },
  {
    name: "list_forms",
    description: "List forms.",
    parameters: { type: "OBJECT", properties: {} },
    write: false,
  },
  {
    name: "list_form_responses",
    description: "List responses to a form (only forms the user runs show everyone's answers).",
    parameters: { type: "OBJECT", properties: { formId: { type: "STRING" } }, required: ["formId"] },
    write: false,
  },
  {
    name: "create_document",
    description: "Create a document written in the portal (markdown body), or a link with externalUrl.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        description: { type: "STRING" },
        departmentId: { type: "STRING" },
        body: { type: "STRING", description: "Markdown" },
        externalUrl: { type: "STRING" },
        tags: { type: "STRING", description: "Comma separated" },
      },
      required: ["title", "departmentId"],
    },
    write: true,
  },
  {
    name: "read_audit_log",
    description: "Recent audit log entries (admins only).",
    parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" } } },
    write: false,
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function geminiToolDeclarations() {
  return [
    {
      functionDeclarations: TOOLS.map(({ name, description, parameters }) => ({
        name,
        description: description + (TOOL_BY_NAME.get(name)?.write ? " (asks the user to confirm)" : ""),
        parameters,
      })),
    },
  ];
}

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown, d: number, max: number) =>
  Math.min(max, Math.max(1, Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d));

/**
 * Run a server action as if its form had been submitted, and turn its
 * redirect-on-success into a result instead of letting it escape.
 */
async function runAction(
  action: (prev: FormState, fd: FormData) => Promise<FormState>,
  fields: Record<string, string | string[] | undefined>,
): Promise<{ ok: boolean; message: string; href?: string }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  try {
    const state = await action({}, fd);
    if (state?.error) return { ok: false, message: state.error };
    return { ok: true, message: state?.ok ?? "Done." };
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      const href = digest.split(";")[2];
      return { ok: true, message: "Done.", href };
    }
    if (error instanceof Error && error.name === "AuthorizationError") {
      return { ok: false, message: `Not allowed: ${error.message}` };
    }
    throw error;
  }
}

async function execute(viewer: Viewer, name: string, a: Args): Promise<unknown> {
  switch (name) {
    case "list_departments": {
      const rows = await db.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
      return rows.filter((d) => can(viewer, "read", { kind: "department", departmentId: d.id }));
    }

    case "list_assignments": {
      const rows = await db.assignment.findMany({
        where: {
          deletedAt: null,
          ...(a.departmentId ? { departmentId: str(a.departmentId) } : {}),
          ...(a.status ? { status: str(a.status) as never } : {}),
          ...(a.mine ? { assignees: { some: { userId: viewer.id } } } : {}),
        },
        select: {
          id: true, title: true, status: true, priority: true, dueDate: true,
          departmentId: true, createdById: true,
          department: { select: { name: true } },
          assignees: { select: { userId: true, user: { select: { name: true } } } },
        },
        orderBy: { updatedAt: "desc" },
        take: num(a.limit, 25, 100),
      });
      return rows
        .filter((r) =>
          can(viewer, "read", {
            kind: "assignment",
            departmentId: r.departmentId,
            createdById: r.createdById,
            ownerIds: r.assignees.map((x) => x.userId),
          }),
        )
        .map((r) => ({
          id: r.id, title: r.title, status: r.status, priority: r.priority,
          dueDate: r.dueDate?.toISOString().slice(0, 10) ?? null,
          department: r.department.name,
          assignees: r.assignees.map((x) => x.user.name),
          href: `/assignments/${r.id}`,
        }));
    }

    case "create_assignment":
      return runAction(createAssignment, {
        title: str(a.title),
        description: str(a.description),
        departmentId: str(a.departmentId),
        dueDate: str(a.dueDate),
        priority: str(a.priority) || "MEDIUM",
        status: str(a.status) || "NOT_STARTED",
        assigneeIds: Array.isArray(a.assigneeIds) ? a.assigneeIds.map(str) : [],
      });

    case "update_assignment": {
      const current = await db.assignment.findFirst({
        where: { id: str(a.id), deletedAt: null },
        include: { assignees: { select: { userId: true } } },
      });
      if (!current) return { ok: false, message: "That task does not exist." };
      return runAction(updateAssignment, {
        id: current.id,
        title: a.title !== undefined ? str(a.title) : current.title,
        description: a.description !== undefined ? str(a.description) : (current.description ?? ""),
        departmentId: current.departmentId,
        dueDate: a.dueDate !== undefined ? str(a.dueDate) : (current.dueDate?.toISOString().slice(0, 10) ?? ""),
        priority: a.priority !== undefined ? str(a.priority) : current.priority,
        status: a.status !== undefined ? str(a.status) : current.status,
        linkUrl: current.linkUrl ?? "",
        recurrence: current.recurrence ?? "",
        assigneeIds: Array.isArray(a.assigneeIds)
          ? a.assigneeIds.map(str)
          : current.assignees.map((x) => x.userId),
      });
    }

    case "create_announcement":
      return runAction(createAnnouncement, {
        title: str(a.title),
        body: str(a.body),
        scope: str(a.scope) || "department",
        departmentId: str(a.departmentId) || viewer.departmentId || "",
        pinned: a.pinned ? "on" : undefined,
      });

    case "list_people": {
      const q = str(a.query).trim();
      const rows = await db.user.findMany({
        where: {
          deletedAt: null,
          ...(a.departmentId ? { departmentId: str(a.departmentId) } : {}),
          ...(q ? { OR: [{ name: { contains: q } }, { nickname: { contains: q } }] } : {}),
        },
        select: { id: true, name: true, nickname: true, tier: true, department: { select: { name: true } } },
        orderBy: { name: "asc" },
        take: 100,
      });
      return rows
        .filter((u) => can(viewer, "read", { kind: "user", userId: u.id }))
        .map((u) => ({ id: u.id, name: u.name, nickname: u.nickname, tier: u.tier, department: u.department?.name ?? null }));
    }

    case "search":
      return searchPortal(viewer, str(a.query));

    case "list_forms": {
      const rows = await db.form.findMany({
        where: { deletedAt: null },
        select: { id: true, title: true, type: true, isOpen: true, deadline: true, ownerId: true, departmentId: true, responseCount: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const competition = new Set(
        (await db.competitionWorkflow.findMany({ select: { formId: true } })).map((w) => w.formId),
      );
      return rows
        .filter((f) => can(viewer, "read", { kind: "form", departmentId: f.departmentId, ownerId: f.ownerId }))
        .filter((f) => !competition.has(f.id) || canCompetition(viewer, "view"))
        .map((f) => ({ id: f.id, title: f.title, type: f.type, isOpen: f.isOpen, deadline: f.deadline, responseCount: f.responseCount, href: `/forms/${f.id}` }));
    }

    case "list_form_responses": {
      const form = await db.form.findFirst({ where: { id: str(a.formId), deletedAt: null } });
      if (!form) return { ok: false, message: "That form does not exist." };
      const resource = { kind: "form" as const, departmentId: form.departmentId, ownerId: form.ownerId };
      if (!can(viewer, "read", resource)) return { ok: false, message: "Not allowed to read this form." };
      const manages = can(viewer, "update", resource);
      const rows = await db.formResponse.findMany({
        where: manages ? { formId: form.id } : { formId: form.id, userId: viewer.id },
        include: { user: { select: { name: true } } },
        orderBy: { submittedAt: "desc" },
        take: 100,
      });
      return {
        scope: manages ? "all responses" : "only your own response",
        responses: rows.map((r) => ({ by: r.user?.name ?? "anonymous", submittedAt: r.submittedAt, answers: r.payload })),
      };
    }

    case "create_document": {
      const external = str(a.externalUrl);
      return runAction(createDocument, {
        title: str(a.title),
        description: str(a.description),
        departmentId: str(a.departmentId),
        source: external ? "external" : "portal",
        externalUrl: external,
        body: str(a.body),
        status: "DRAFT",
        tags: str(a.tags),
      });
    }

    case "read_audit_log": {
      if (!isAdmin(viewer) || !can(viewer, "view_audit", { kind: "system" })) {
        return { ok: false, message: "Not allowed to read the audit log." };
      }
      const rows = await db.auditLog.findMany({
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: num(a.limit, 30, 100),
      });
      return rows.map((r) => ({ at: r.createdAt, who: r.user?.name ?? "system", action: r.action, detail: r.detail }));
    }
  }
  return { ok: false, message: `Unknown tool ${name}.` };
}

/** Run one tool as `viewer`, and log it either way. */
export async function runTool(viewer: Viewer, name: string, args: Args): Promise<unknown> {
  const tool = TOOL_BY_NAME.get(name);
  let result: unknown;
  let failed = false;
  try {
    result = tool ? await execute(viewer, name, args ?? {}) : { ok: false, message: `Unknown tool ${name}.` };
    if (result && typeof result === "object" && "ok" in result && (result as { ok: boolean }).ok === false) failed = true;
  } catch (error) {
    failed = true;
    result = { ok: false, message: error instanceof Error ? error.message : "The tool failed." };
  }
  const summary = JSON.stringify(args ?? {}).slice(0, 400);
  const reason = failed ? ` — failed: ${(result as { message?: string })?.message ?? "error"}` : "";
  await audit(viewer.id, `ai.tool.${name}`.slice(0, 64), {
    type: "ai",
    detail: `${name} via AI assistant ${summary}${reason}`,
  });
  return result;
}
