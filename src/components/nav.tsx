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
      <aside className="hs-no-print hidden w-[236px] shrink-0 border-r border-line bg-surface lg:flex lg:sticky lg:top-0 lg:h-screen lg:flex-col lg:justify-between lg:px-4 lg:py-5 lg:gap-5">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-5 mt-2 flex justify-center px-1">
            <Wordmark />
          </div>
          <NavSearch />
          {links}
        </div>
        {profile}
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
