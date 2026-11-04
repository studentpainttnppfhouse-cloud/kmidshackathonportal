import { TIER_ORDER } from "@/lib/constants";
import type { PageAccessLevel, Tier } from "@prisma/client";

/**
 * The portal, page by page, and what each tier may do with each one.
 *
 * `policy.ts` answers "may this person change this record?". This file answers
 * the question in front of it: "may this person be on this page at all?" The
 * two are deliberately separate. Record rules are the shape of the work — a
 * head approves inside their own team, a member edits their own task — and
 * those do not change from one season to the next. Page rules are the owner's
 * to set, because which teams get to see the audit log or the accounts screen
 * is an organisational decision, not an engineering one.
 *
 * Three properties hold, and everything below exists to keep them true:
 *
 *   1. This grid only ever *narrows*. A tier set to EDIT here still only does
 *      what its role allows, so handing members EDIT on Announcements does not
 *      make them broadcasters. That is why a mistake in the grid is a page
 *      somebody cannot reach, never a permission somebody should not have.
 *
 *   2. The defaults are today's behaviour, exactly. An untouched portal after
 *      this change behaves like the portal before it, so the feature is opt-in
 *      one cell at a time rather than a migration everybody has to survive.
 *
 *   3. Some cells cannot be set at all. The owner may not hide the dashboard
 *      from themselves, and no grid entry can put a member in the accounts
 *      screen. Those are `locked` and `floor` below, and they are enforced in
 *      `page-access.ts` rather than in the form, because a disabled radio is
 *      not access control.
 */

export type PageKey =
  | "dashboard"
  | "assignments"
  | "my-tasks"
  | "calendar"
  | "departments"
  | "people"
  | "documents"
  | "files"
  | "brand"
  | "forms"
  | "announcements"
  | "event"
  | "notifications"
  | "admin"
  | "audit"
  | "search"
  | "settings"
  | "help";

export type PortalPage = {
  key: PageKey;
  label: string;
  href: string;
  /** Whether the page earns a row in the sidebar when the tier may see it. */
  nav: boolean;
  /** One line, written for the person setting the grid rather than for a dev. */
  blurb: string;
  /**
   * Pages nobody may be locked out of.
   *
   * Signing in lands on /dashboard and every "you cannot do that" redirect goes
   * there, so hiding it would turn a wrong click into a redirect loop. Settings
   * is where a person changes their own password, and Help is where they find
   * out why something is missing. A locked page can be held at READ, never at
   * NONE.
   */
  locked?: boolean;
  /**
   * The lowest tier this page may ever be opened to, whatever the grid says.
   *
   * Accounts, invites, sessions and the audit log carry other people's data and
   * the levers to take over their accounts. Those stay above a floor so that a
   * mis-click in the grid cannot hand the accounts screen to sixty students.
   */
  floor?: Tier;
};

export const PORTAL_PAGES: readonly PortalPage[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    nav: true,
    locked: true,
    blurb: "Where everybody lands. Countdown, own tasks, latest announcements.",
  },
  {
    key: "my-tasks",
    label: "My assignments",
    href: "/my-tasks",
    nav: true,
    blurb: "A person's own tasks, whatever team they sit in.",
  },
  {
    key: "assignments",
    label: "Assignments board",
    href: "/assignments",
    nav: true,
    blurb: "Task pages. The board and list index is for heads and up; members open their own tasks from here.",
  },
  {
    key: "calendar",
    label: "Calendar",
    href: "/calendar",
    nav: true,
    blurb: "Every visible task laid out by due date.",
  },
  {
    key: "departments",
    label: "Departments",
    href: "/departments",
    nav: true,
    blurb: "The ten teams, their members, and the work sitting in each one.",
  },
  {
    key: "people",
    label: "People",
    href: "/people",
    nav: true,
    blurb: "The staff directory: names, roles, phone numbers, LINE IDs.",
  },
  {
    key: "documents",
    label: "Documents",
    href: "/documents",
    nav: true,
    blurb: "Proposals, rubrics, scripts and run sheets, with their approvals.",
  },
  {
    key: "files",
    label: "Files & Assets (now in Brand kit)",
    href: "/files",
    nav: false,
    blurb: "Uploads and links: decks, exports, photos, anything shared.",
  },
  {
    key: "brand",
    label: "Brand kit",
    href: "/brand",
    nav: true,
    blurb: "Colours, type and logo rules, plus every shared file and asset.",
  },
  {
    key: "forms",
    label: "Forms",
    href: "/forms",
    nav: true,
    blurb: "Internal forms and their responses. COMMENT is enough to answer one.",
  },
  {
    key: "announcements",
    label: "Announcements",
    href: "/announcements",
    nav: true,
    blurb: "All-staff and per-team posts, and who has read them.",
  },
  {
    key: "event",
    label: "Event Day",
    href: "/event",
    nav: true,
    blurb: "Run sheet, check-ins and the incident log. Hidden until switched on.",
  },
  {
    key: "notifications",
    label: "Teams alerts",
    href: "/notifications",
    nav: true,
    blurb: "What the portal pushes into Microsoft Teams, and the delivery log.",
  },
  {
    key: "admin",
    label: "Admin",
    href: "/admin",
    nav: true,
    floor: "T3_ADMIN",
    blurb: "Accounts, invites, join links, tiers and live sessions.",
  },
  {
    key: "audit",
    label: "Audit log",
    href: "/admin/audit",
    nav: true,
    floor: "T3_ADMIN",
    blurb: "Every action anybody has taken in the portal, with names attached.",
  },
  {
    key: "search",
    label: "Search",
    href: "/search",
    nav: false,
    blurb: "Portal-wide search. Results are filtered by these same rules.",
  },
  {
    key: "settings",
    label: "My settings",
    href: "/settings",
    nav: false,
    locked: true,
    blurb: "A person's own profile, password and devices. Always their own.",
  },
  {
    key: "help",
    label: "Help",
    href: "/help",
    nav: false,
    locked: true,
    blurb: "How the portal works, and who to ask when it does not.",
  },
];

export const PAGE_BY_KEY: Record<PageKey, PortalPage> = Object.fromEntries(
  PORTAL_PAGES.map((page) => [page.key, page]),
) as Record<PageKey, PortalPage>;

export const ACCESS_LEVELS = ["NONE", "READ", "COMMENT", "EDIT"] as const;

export const ACCESS_LEVEL_ORDER: Record<PageAccessLevel, number> = {
  NONE: 0,
  READ: 1,
  COMMENT: 2,
  EDIT: 3,
};

export const ACCESS_LEVEL_LABEL: Record<PageAccessLevel, string> = {
  NONE: "Hidden",
  READ: "Read only",
  COMMENT: "Read & reply",
  EDIT: "Full",
};

export const ACCESS_LEVEL_BLURB: Record<PageAccessLevel, string> = {
  NONE: "Not in the menu, and the address bounces back to the dashboard.",
  READ: "Opens the page. Changes nothing, posts nothing.",
  COMMENT: "Opens the page, comments on threads, and answers forms.",
  EDIT: "Everything their role already allows here.",
};

/** Short enough to sit in a grid cell. */
export const ACCESS_LEVEL_SHORT: Record<PageAccessLevel, string> = {
  NONE: "Hidden",
  READ: "Read",
  COMMENT: "Reply",
  EDIT: "Full",
};

export const TIERS: readonly Tier[] = [
  "T0_ADVISOR",
  "T1_MEMBER",
  "T2_HEAD",
  "T3_ADMIN",
  "T4_OWNER",
];

/**
 * The grid as it ships: exactly what each tier could reach before this feature
 * existed.
 *
 * Everything is EDIT — because "EDIT" here means no extra restriction on top of
 * the role — except the three places where a tier already had no business being:
 * the accounts screen below T3, the audit log below T4, and the Teams alert
 * panel below T2, which only a head or an admin could ever send from anyway.
 */
export function defaultAccess(key: PageKey, tier: Tier): PageAccessLevel {
  const rank = TIER_ORDER[tier];

  switch (key) {
    case "admin":
      return rank >= TIER_ORDER.T3_ADMIN ? "EDIT" : "NONE";
    case "audit":
      // The log names who did what to whom. It was already the one screen the
      // sidebar showed to the owner alone; the floor above lets that be relaxed
      // to T3, but relaxing it stays a decision somebody makes on purpose.
      return rank >= TIER_ORDER.T4_OWNER ? "EDIT" : "NONE";
    case "notifications":
      return rank >= TIER_ORDER.T2_HEAD ? "EDIT" : "NONE";
    default:
      return "EDIT";
  }
}

/**
 * The narrowest and widest a cell may be set to.
 *
 * Returned as a pair because the grid needs both — it greys out what it cannot
 * offer — and because `page-access.ts` clamps every stored value through the
 * same function, so a row written before a page gained a floor is corrected on
 * read rather than trusted.
 */
export function accessBounds(
  key: PageKey,
  tier: Tier,
): {
  min: PageAccessLevel;
  max: PageAccessLevel;
} {
  const page = PAGE_BY_KEY[key];

  // The owner is never locked out of anything. Somebody has to be able to
  // unlock the portal after a bad afternoon with this grid, and on a portal
  // with one owner that person is the only candidate.
  if (tier === "T4_OWNER") return { min: "EDIT", max: "EDIT" };

  if (page?.floor && TIER_ORDER[tier] < TIER_ORDER[page.floor]) {
    return { min: "NONE", max: "NONE" };
  }

  if (page?.locked) return { min: "READ", max: "EDIT" };

  return { min: "NONE", max: "EDIT" };
}

export function clampAccess(key: PageKey, tier: Tier, level: PageAccessLevel): PageAccessLevel {
  const { min, max } = accessBounds(key, tier);
  const rank = ACCESS_LEVEL_ORDER[level];
  if (rank < ACCESS_LEVEL_ORDER[min]) return min;
  if (rank > ACCESS_LEVEL_ORDER[max]) return max;
  return level;
}

export function isPageKey(value: string): value is PageKey {
  return value in PAGE_BY_KEY;
}

export function isAccessLevel(value: string): value is PageAccessLevel {
  return value in ACCESS_LEVEL_ORDER;
}

/**
 * Which page a URL belongs to.
 *
 * Longest prefix wins, so /admin/audit resolves to the audit log rather than to
 * the accounts screen it happens to sit under. Nested routes come along for
 * free: /documents/abc/edit is the Documents page, which is the whole point —
 * hiding a page has to hide everything underneath it, not just its index.
 */
export function pageForPath(pathname: string): PortalPage | null {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";

  let best: PortalPage | null = null;
  for (const page of PORTAL_PAGES) {
    if (path === page.href || path.startsWith(`${page.href}/`)) {
      if (!best || page.href.length > best.href.length) best = page;
    }
  }
  return best;
}
