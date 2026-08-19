'use client';

import { useState } from 'react';
import { Eye, X } from 'lucide-react';
import type { SessionUser } from '@/lib/types';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { StopImpersonatingButton } from './stop-impersonating';

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="sticky top-0 hidden h-screen md:block">
        <Sidebar tier={user.effectiveTier} />
      </div>

      {/* Mobile drawer — event-day staff are on phones (§2.4) */}
      {navOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-[rgba(31,41,55,0.35)]"
          />
          <div className="absolute inset-y-0 left-0 animate-fadeup-fast">
            <Sidebar tier={user.effectiveTier} onNavigate={() => setNavOpen(false)} />
          </div>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-surface text-ink shadow-raised"
          >
            <X size={18} />
          </button>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} onOpenNav={() => setNavOpen(true)} />

        {user.impersonating ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-3 px-4 py-2.5 text-[12.5px] font-semibold text-deep md:px-[22px]">
            <Eye size={15} strokeWidth={2} />
            Previewing as <strong>{user.impersonating}</strong> — this session is read-only.
            <StopImpersonatingButton />
          </div>
        ) : null}

        <main id="screen-mount" className="flex-1 overflow-y-auto p-4 md:p-[26px]">
          {children}
        </main>
      </div>
    </div>
  );
}
