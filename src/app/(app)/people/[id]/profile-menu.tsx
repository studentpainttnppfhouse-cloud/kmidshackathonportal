"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";

export type ProfileSetting = {
  key: string;
  label: string;
  hint: string;
  title: string;
  description?: string;
  content: ReactNode;
};

/**
 * The three-dots button on a profile. Opens a small floating menu; each item
 * opens its settings in the centred pop-up. Add a new setting by adding an
 * entry to `settings` on the page.
 */
export function ProfileMenu({ settings }: { settings: ProfileSetting[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);

  if (settings.length === 0) return null;
  const current = settings.find((s) => s.key === active) ?? null;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label="Profile settings"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface/80 text-ink backdrop-blur transition hover:border-brand hover:text-brand-deep"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-[var(--hs-shadow-lift)]"
          style={{ animation: "hs-enter 0.14s ease-out both" }}
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">Settings</p>
          {settings.map((s) => (
            <button
              key={s.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setActive(s.key);
              }}
              className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-tint/60"
            >
              <span className="block text-sm font-semibold text-ink">{s.label}</span>
              <span className="block text-xs text-muted">{s.hint}</span>
            </button>
          ))}
        </div>
      ) : null}

      <Modal
        open={current !== null}
        onClose={() => setActive(null)}
        title={current?.title ?? ""}
        description={current?.description}
        size="lg"
      >
        {current?.content}
      </Modal>
    </div>
  );
}
