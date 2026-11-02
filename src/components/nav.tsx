"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/brand";
import { Avatar, TierPill } from "@/components/ui";
import { ThemeToggle } from "@/components/chrome";
import type { Tier } from "@prisma/client";

export type NavItem = { href: string; label: string; badge?: number };

const groups = [
  { label: "Workspace", paths: ["/dashboard", "/announcements", "/my-tasks", "/assignments", "/calendar", "/departments", "/people", "/assistant"] },
  { label: "Shared resources", paths: ["/documents", "/brand", "/forms"] },
  { label: "Manage", paths: ["/admin", "/admin/audit"] },
];
const dailyPaths = ["/dashboard", "/my-tasks", "/calendar", "/departments"];
const shortLabels: Record<string, string> = {
  "/dashboard": "Home", "/my-tasks": "Tasks", "/calendar": "Calendar", "/departments": "Teams",
};

/** Small line icons for the collapsed sidebar rail. */
const ICON: Record<string, string> = {
  "/dashboard": "M3 11l9-7 9 7M5 10v10h14V10",
  "/announcements": "M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1zM16 9a4 4 0 0 1 0 6",
  "/my-tasks": "M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11",
  "/assignments": "M4 4h6v16H4zM14 4h6v10h-6z",
  "/calendar": "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  "/departments": "M4 20v-2a4 4 0 0 1 4-4h2M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM14 20v-2a4 4 0 0 1 4-4M17 10a3 3 0 1 0 0-6",
  "/people": "M5 20v-1a6 6 0 0 1 14 0v1M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  "/assistant": "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z",
  "/documents": "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  "/brand": "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.5-4-8.5-9-8.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
  "/forms": "M6 3h12v18H6zM9 8h6M9 12h6M9 16h3",
  "/admin": "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  "/admin/audit": "M4 5h16M4 10h16M4 15h10M4 20h7",
  "/help": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01",
  "/search": "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
};

function NavIcon({ href }: { href: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d={ICON[href] ?? "M12 12h.01"} />
    </svg>
  );
}

const COLLAPSE_KEY = "hs-sidebar-collapsed";

export function AppNav({
  items,
  viewer,
  signOutAction,
}: {
  items: NavItem[];
  viewer: {
    name: string;
    nickname: string | null;
    avatarUrl: string | null;
    tier: Tier;
    departmentName: string | null;
  };
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Remembered per browser. Read after mount so the server render and the
  // first client render agree.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  const panel = useRef<HTMLDialogElement | null>(null);
  const menuButton = useRef<HTMLButtonElement | null>(null);

  // A route change closes the sheet. Without this, tapping a link on a phone
  // navigates behind a menu that is still covering the page.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    if (!open) {
      dialog.close();
      return;
    }
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnDesktop = () => {
      if (window.matchMedia("(min-width: 1024px)").matches) setOpen(false);
    };
    window.addEventListener("resize", closeOnDesktop);
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      window.removeEventListener("resize", closeOnDesktop);
    };
  }, [open]);

  // Only the most specific destination is current (Admin must not also be
  // selected while its Audit log is open).
  const activeHref = items
    .filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (href: string) => href === activeHref;
  const dailyItems = dailyPaths.flatMap((path) => items.filter((item) => item.href === path));

  const links = (
    <nav className="space-y-5" aria-label="Main">
      {groups.map((group) => {
        const visible = group.paths.flatMap((path) => items.filter((item) => item.href === path));
        if (!visible.length) return null;
        return (
          <div key={group.label}>
            <p className="mb-1 px-3 text-xs font-semibold text-faint">{group.label}</p>
            <ul className="space-y-0.5">
              {visible.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setOpen(false)}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={`hs-nav-link ${isActive(item.href) ? "is-active" : ""}`}>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.badge ? <span className="hs-nav-count">{item.badge}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <Link href="/help" onClick={() => setOpen(false)} className="hs-nav-link"
        aria-current={pathname === "/help" ? "page" : undefined}>Help & getting started</Link>
    </nav>
  );

  const rail = (
    <nav className="flex flex-col items-center gap-1" aria-label="Main">
      <Link href="/search" title="Search" aria-label="Search" className="hs-nav-link justify-center px-0 w-10">
        <NavIcon href="/search" />
      </Link>
      {groups.map((group) => {
        const visible = group.paths.flatMap((path) => items.filter((item) => item.href === path));
        if (!visible.length) return null;
        return (
          <div key={group.label} className="flex w-full flex-col items-center gap-1 border-t border-line pt-1 first:border-0">
            {visible.map((item) => (
              <Link key={item.href} href={item.href} title={item.label} aria-label={item.label}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`hs-nav-link relative w-10 justify-center px-0 ${isActive(item.href) ? "is-active" : ""}`}>
                <NavIcon href={item.href} />
                {item.badge ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-brand" /> : null}
              </Link>
            ))}
          </div>
        );
      })}
      <Link href="/help" title="Help & getting started" aria-label="Help" className="hs-nav-link w-10 justify-center px-0 border-t border-line">
        <NavIcon href="/help" />
      </Link>
    </nav>
  );

  const collapseButton = (
    <button type="button" onClick={toggleCollapsed}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-tint hover:text-ink">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16v16H4zM9 4v16" />
        <path d={collapsed ? "M13 10l2 2-2 2" : "M16 10l-2 2 2 2"} />
      </svg>
    </button>
  );

  const profile = (
    <div className="border-t border-line pt-4">
      <Link
        href="/settings"
        className="flex items-center gap-2.5 rounded-[10px] px-1 py-1.5 transition hover:bg-tint/60"
      >
        <Avatar name={viewer.name} nickname={viewer.nickname} url={viewer.avatarUrl} size={34} />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold text-ink">
            {viewer.nickname || viewer.name}
          </span>
          <span className="block truncate text-[11px] text-faint">
            {viewer.departmentName ?? "No department"}
          </span>
        </span>
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2 px-1">
        <TierPill tier={viewer.tier} />
        <ThemeToggle />
      </div>
      <form action={signOutAction} className="mt-3">
        <button type="submit" className="hs-btn hs-btn-ghost w-full justify-start px-3 text-sm">
          Sign out
        </button>
      </form>
    </div>
  );

  return (
    <>
      {/* Mobile bar */}
      <header className="hs-no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <Wordmark />
        <div className="flex items-center gap-1.5">
          <Link
            href="/search"
            className="hs-btn hs-btn-ghost px-3"
            aria-label="Search the portal"
            title="Search"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          </Link>
          <button
            type="button"
            ref={menuButton}
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls="hs-mobile-nav"
            className="hs-btn hs-btn-ghost px-3"
          >
            <span className="sr-only">Open menu</span>
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </header>

      <dialog id="hs-mobile-nav" ref={panel} className="hs-mobile-menu hs-no-print"
        aria-label="Portal menu" onCancel={() => setOpen(false)}
        onClose={() => { setOpen(false); menuButton.current?.focus(); }}
        onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <Wordmark />
          <button type="button" className="hs-btn hs-btn-secondary" onClick={() => setOpen(false)}>Close menu</button>
        </div>
        {links}
        <div className="mt-5">{profile}</div>
      </dialog>

      <nav aria-label="Quick access" className="hs-mobile-tabs hs-no-print lg:hidden">
        {dailyItems.map((item) => (
          <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={isActive(item.href) ? "is-active" : ""}>
            {shortLabels[item.href]}
            {item.badge ? <span className="hs-nav-count">{item.badge}</span> : null}
          </Link>
        ))}
      </nav>

      {/* Desktop sidebar */}
      <aside className={`hs-no-print hidden shrink-0 border-r border-line bg-surface transition-[width] duration-200 lg:flex lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:justify-between lg:py-5 lg:gap-5 ${collapsed ? "w-[68px] lg:px-2" : "w-[236px] lg:px-4"}`}>
        {collapsed ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <div className="mb-3 flex justify-center">{collapseButton}</div>
              {rail}
            </div>
            <div className="flex flex-col items-center gap-2 border-t border-line pt-3">
              <Link href="/settings" title={viewer.nickname || viewer.name}>
                <Avatar name={viewer.name} nickname={viewer.nickname} url={viewer.avatarUrl} size={34} />
              </Link>
              <form action={signOutAction}>
                <button type="submit" title="Sign out" aria-label="Sign out"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-tint hover:text-ink">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="relative mb-5 mt-2 flex justify-center px-1">
                <Wordmark />
                <div className="absolute -right-2 top-1/2 -translate-y-1/2">{collapseButton}</div>
              </div>
              <NavSearch />
              {links}
            </div>
            {profile}
          </>
        )}
      </aside>
    </>
  );
}

/**
 * The sidebar search box.
 *
 * Submits to /search rather than filtering in place: the results span seven
 * kinds of record and every one of them is permission-filtered on the server,
 * which is not a decision a client-side filter could make honestly.
 */
function NavSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  return (
    <form
      role="search"
      className="mb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (query.length > 0) router.push(`/search?q=${encodeURIComponent(query)}`);
      }}
    >
      <label htmlFor="hs-nav-search" className="sr-only">
        Search the portal
      </label>
      <input
        id="hs-nav-search"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search everything…"
        className="hs-input py-2 text-sm"
        autoComplete="off"
      />
    </form>
  );
}
