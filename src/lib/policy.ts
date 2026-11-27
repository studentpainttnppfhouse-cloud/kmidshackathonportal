import { TIER_ORDER } from "@/lib/constants";
import { clampAccess, defaultAccess, type PageKey } from "@/lib/pages";
import type { Department, PageAccessLevel, Tier, User } from "@prisma/client";

/**
 * A signed-in person, as every policy decision sees them.
 *
 * `pageGrants` is the owner's page-by-tier grid, already resolved for this
 * person's tier by `getViewer()`. It is optional so that a caller holding only
 * a database row — a test, a background job, the notification dispatcher —
 * still type-checks; when it is missing the built-in defaults apply, and those
 * are the portal's behaviour before the grid existed.
 */
export type Viewer = User & {
  department: Department | null;
  pageGrants?: Partial<Record<PageKey, PageAccessLevel>>;
};

/**
 * The one permission module.
 *
 * TiDB has no row-level security, so the database will happily return any row
 * the application asks for. Every read and every write therefore goes through
 * `authorize()` — no page and no route handler decides for itself. Hiding a
 * button is not security, and neither is a `WHERE departmentId = ?` that
 * somebody forgets to write.
 *
 * Tiers are cumulative. T2 can do everything T1 can, inside its department.
 */

export type Action =
  | "read"
  | "comment"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "assign"
  | "publish"
  | "manage_users"
  | "manage_departments"
  | "manage_sessions"
  | "view_audit"
  | "export"
  | "archive"
  | "view_private_notes"
  | "notify"
  | "manage_notifications";

/** Anything with a department and an owner can be checked against a viewer. */
export type Resource =
  | { kind: "department"; departmentId: string }
  | { kind: "assignment"; departmentId: string; ownerIds: string[]; createdById: string }
  | { kind: "document"; departmentId: string; ownerId: string }
  | { kind: "file"; departmentId: string; ownerId: string }
  | { kind: "announcement"; departmentId: string | null; authorId: string }
  | { kind: "comment"; authorId: string }
  | { kind: "user"; userId: string }
  | { kind: "form"; departmentId: string | null; ownerId: string }
  | { kind: "incident" }
  | { kind: "notification"; departmentId: string | null }
  | { kind: "private_notes" }
  | { kind: "system" };

export function atLeast(user: { tier: Tier }, tier: Tier): boolean {
  return TIER_ORDER[user.tier] >= TIER_ORDER[tier];
}

export function isAdmin(user: { tier: Tier }): boolean {
  return atLeast(user, "T3_ADMIN");
}

export function isOwner(user: { tier: Tier }): boolean {
  return user.tier === "T4_OWNER";
}

/** Advisors read broadly but write nothing except comments and approvals. */
function isAdvisor(user: { tier: Tier }): boolean {
  return user.tier === "T0_ADVISOR";
}

function inDepartment(user: Viewer, departmentId: string | null): boolean {
  if (departmentId === null) return true; // portal-wide / General space
  return user.departmentId === departmentId;
}

/** Head of the department the resource lives in. */
function headOf(user: Viewer, departmentId: string | null): boolean {
  return user.tier === "T2_HEAD" && departmentId !== null && user.departmentId === departmentId;
}

// ---------------------------------------------------------------------------
// The page grid — the owner's layer, sitting on top of the rules above
// ---------------------------------------------------------------------------

/**
 * Which page a kind of record lives on.
 *
 * Hiding Assignments has to stop a member from editing a task, not just from
 * seeing the board — otherwise the grid is decoration and a server action is
 * the way around it. Mapping each resource to its page is what makes the single
 * check in `can()` cover every write in the codebase, because every write
 * already goes through `can()`.
 *
 * `comment` and `system` map to nothing on purpose. A comment belongs to
 * whatever it hangs off, so `addComment` checks the parent's own page, and
 * `system` is the catch-all resource used by actions that are gated by the
 * action map below instead.
 */
const PAGE_FOR_RESOURCE: Record<Resource["kind"], PageKey | null> = {
  department: "departments",
  assignment: "assignments",
  document: "documents",
  file: "files",
  announcement: "announcements",
  form: "forms",
  user: "people",
  private_notes: "people",
  incident: "event",
  notification: "notifications",
  comment: null,
  system: null,
};

/**
 * Actions that only look at data.
 *
 * `view_audit` and `view_private_notes` read like verbs but are reads, so a
 * page held at READ still permits them — the tier rules above are what decide
 * whether this particular person may look.
 */
const READ_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "read",
  "view_audit",
  "view_private_notes",
]);

/** Actions whose page is decided by what is being done, not what it is done to. */
const PAGE_FOR_ACTION: Partial<Record<Action, PageKey>> = {
  view_audit: "audit",
  manage_users: "admin",
  manage_sessions: "admin",
  manage_departments: "departments",
  manage_notifications: "notifications",
  notify: "notifications",
};

/** What this person may do on this page: their grant, or the shipped default. */
export function pageLevel(
  user: {
    tier: Tier;
    pageGrants?: Partial<Record<PageKey, PageAccessLevel>>;
  } | null,
  key: PageKey,
): PageAccessLevel {
  if (!user) return "NONE";
  const stored = user.pageGrants?.[key];
  return clampAccess(key, user.tier, stored ?? defaultAccess(key, user.tier));
}

export function canSeePage(user: Viewer | null, key: PageKey): boolean {
  return pageLevel(user, key) !== "NONE";
}

/** True when the page lets this person change things, role permitting. */
export function canEditPage(user: Viewer | null, key: PageKey): boolean {
  return pageLevel(user, key) === "EDIT";
}

/**
 * The grid's verdict on one action, before the role rules get a say.
 *
 * Deliberately one-directional: this can only turn a yes into a no. EDIT
 * abstains rather than granting, which is what makes a wrong cell in the grid a
 * page somebody cannot reach instead of a permission somebody should not have.
 */
function allowedByPage(user: Viewer, action: Action, resource: Resource): boolean {
  const key = PAGE_FOR_ACTION[action] ?? PAGE_FOR_RESOURCE[resource.kind];
  if (!key) return true;

  const level = pageLevel(user, key);
  if (level === "EDIT") return true;
  if (level === "NONE") return false;
  if (READ_ACTIONS.has(action)) return true;
  // READ stops at reading; COMMENT adds replying to a thread and answering a
  // form, which are the two writes that are part of taking part rather than
  // part of running the place.
  return level === "COMMENT" && action === "comment";
}

export function can(user: Viewer | null, action: Action, resource: Resource): boolean {
  if (!user) return false;
  if (!user.isActive || user.deletedAt) return false;

  // Alumni and un-activated reserve staff are read-only, whatever their tier.
  const readOnly = user.isAlumni || (user.isReserve && !user.isActive);
  if (readOnly && action !== "read") return false;

  // The owner's page grid, applied before anything else has a chance to say
  // yes. It is checked here rather than in each page so that a server action
  // called directly — the thing a hidden nav link does nothing about — lands on
  // the same answer the navigation gave.
  if (!allowedByPage(user, action, resource)) return false;

  // --- Owner-only actions -------------------------------------------------
  if (
    action === "manage_users" ||
    action === "manage_sessions" ||
    action === "archive" ||
    action === "export"
  ) {
    return isOwner(user);
  }

  if (action === "manage_departments" || action === "view_audit") {
    return isAdmin(user);
  }

  // A Teams webhook URL is a credential: whoever holds it can post into a staff
  // channel as the portal, forever, with no further check. Adding, editing and
  // removing one is therefore Admin work even though *using* one is a head's.
  // The same call covers the portal-wide notification rules, which speak for
  // every department at once.
  if (action === "manage_notifications") {
    return isAdmin(user);
  }

  // D1: interview scores and internal performance notes are T3+ only.
  // Advisors do not see them, regardless of their broad read access.
  if (action === "view_private_notes" || resource.kind === "private_notes") {
    return isAdmin(user);
  }

  // --- Reads --------------------------------------------------------------
  if (action === "read") {
    switch (resource.kind) {
      case "incident":
        // Incident log is Admin-only, per the event-day spec.
        return isAdmin(user);
      case "user":
      case "system":
        return true;
      case "notification":
        // The delivery log names who was chased about what, which is a
        // management view rather than a shared one. Heads see their own
        // department and the all-staff channel; admins see everything.
        if (isAdmin(user)) return true;
        if (user.tier !== "T2_HEAD") return false;
        return resource.departmentId === null || user.departmentId === resource.departmentId;
      case "announcement":
        return (
          resource.departmentId === null ||
          isAdvisor(user) ||
          isAdmin(user) ||
          inDepartment(user, resource.departmentId)
        );
      default:
        // Every tier can see across departments read-only. This is the
        // deliberate exception: the whole point of the portal is a shared view.
        return true;
    }
  }

  if (action === "comment") {
    // Everyone signed in may comment, advisors included.
    return true;
  }

  // --- Writes -------------------------------------------------------------
  // Advisors never write anything beyond comments and approvals.
  if (isAdvisor(user)) return action === "approve" && isApprovable(resource);

  if (isAdmin(user)) return true; // T3/T4 write everywhere

  switch (resource.kind) {
    case "assignment": {
      const mine = resource.ownerIds.includes(user.id) || resource.createdById === user.id;
      if (action === "approve" || action === "assign" || action === "delete") {
        return headOf(user, resource.departmentId);
      }
      if (action === "create") return inDepartment(user, resource.departmentId);
      if (action === "update") return mine || headOf(user, resource.departmentId);
      return false;
    }

    case "document":
    case "file": {
      const mine = resource.ownerId === user.id;
      if (action === "approve" || action === "publish") {
        return headOf(user, resource.departmentId);
      }
      if (action === "create") return inDepartment(user, resource.departmentId);
      if (action === "update") return mine || headOf(user, resource.departmentId);
      if (action === "delete") return mine || headOf(user, resource.departmentId);
      return false;
    }

    case "announcement": {
      // Members do not broadcast. Heads announce to their own department.
      if (resource.departmentId === null) return false;
      if (action === "create") return headOf(user, resource.departmentId);
      return resource.authorId === user.id || headOf(user, resource.departmentId);
    }

    case "form": {
      if (action === "create") return headOf(user, resource.departmentId);
      return resource.ownerId === user.id || headOf(user, resource.departmentId);
    }

    case "notification": {
      if (action !== "notify") return false;
      // All-staff goes to everybody's phone, so it stays with Admin — who
      // returned true above and never reach this line. A head speaks for their
      // own department and nobody else's.
      if (resource.departmentId === null) return false;
      return headOf(user, resource.departmentId);
    }

    case "comment":
      return resource.authorId === user.id;

    case "user":
      // Anyone may edit their own profile. Nobody below T3 edits anyone else's.
      return resource.userId === user.id && (action === "update" || action === "create");

    case "department":
      return headOf(user, resource.departmentId) && action === "update";

    default:
      return false;
  }
}

function isApprovable(resource: Resource): boolean {
  return resource.kind === "document" || resource.kind === "assignment";
}

// ---------------------------------------------------------------------------
// Competition forms (the 2027 Round 1 registration workflows)
// ---------------------------------------------------------------------------

/**
 * What staff may do with the competition registration forms.
 *
 * Kept apart from `can()` on purpose. These forms hold minors' contact details,
 * payment slips and identity documents, and the rules for them are their own:
 *
 *   view, export, review   T2 Head and above, every competition form. Heads
 *                          help check registrations and payments, so they see
 *                          all of them, not just their department's.
 *   edit                   T3 Admin and above (the forms are portal-wide, so a
 *                          head's own-department rule never reaches them).
 *   view_identity          T3 Admin and above. National ID and ปพ.7 copies.
 *   correct                T4 Owner. Reopening a locked final entry.
 *   publish                T4 Owner, or an admin the owner has delegated to.
 *
 * Advisors, members, alumni, inactive accounts and anyone the page grid has
 * kept off Forms get none of it. Participants never reach this function: they
 * answer through the public link, which has its own checks.
 */
export type CompetitionOp =
  | "view"
  | "export"
  | "review"
  | "edit"
  | "view_identity"
  | "correct"
  | "publish";

const COMPETITION_WRITES: ReadonlySet<CompetitionOp> = new Set<CompetitionOp>([
  "review",
  "edit",
  "correct",
  "publish",
]);

export function canCompetition(
  user: Viewer | null,
  op: CompetitionOp,
  options: { publishDelegatedToAdmins?: boolean } = {},
): boolean {
  if (!user) return false;
  if (!user.isActive || user.deletedAt) return false;
  if (user.isAlumni) return false;

  const level = pageLevel(user, "forms");
  if (level === "NONE") return false;
  if (COMPETITION_WRITES.has(op) && level !== "EDIT") return false;

  switch (op) {
    case "view":
    case "export":
    case "review":
      return atLeast(user, "T2_HEAD");
    case "edit":
    case "view_identity":
      return isAdmin(user);
    case "correct":
      return isOwner(user);
    case "publish":
      return isOwner(user) || (Boolean(options.publishDelegatedToAdmins) && isAdmin(user));
  }
}
