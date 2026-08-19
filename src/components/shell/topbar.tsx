'use client';

import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { Menu } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { TierBadge } from '@/components/tier-badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { TIERS, type SessionUser } from '@/lib/types';
import { titleFor } from './nav-items';
import { setViewAsAction } from './impersonation';

export function Topbar({
  user,
  onOpenNav,
}: {
  user: SessionUser;
  onOpenNav: () => void;
}) {
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const isOwner = user.tier === 'T4';

  return (
    <header className="sticky top-0 z-20 flex h-[60px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-4 md:px-[22px]">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-ink md:hidden"
      >
        <Menu size={18} strokeWidth={1.75} />
      </button>

      <h1 className="truncate text-[15px] font-bold tracking-[-0.01em]">
        {titleFor(pathname)}
      </h1>

      <div className="flex-1" />

      {isOwner ? (
        <div className="hidden items-center gap-2 rounded-md border border-line bg-surface-2 p-1 lg:flex">
          <span className="pl-1.5 text-[11px] font-semibold text-muted-2">VIEW AS</span>
          {TIERS.map((t) => {
            const active = user.effectiveTier === t;
            return (
              <button
                key={t}
                type="button"
                disabled={pending}
                onClick={() => start(() => void setViewAsAction(t === 'T4' ? null : t))}
                aria-pressed={active}
                className={`rounded-[7px] px-2.5 py-1.5 font-mono text-[12px] font-bold transition-colors ${
                  active ? 'bg-pink text-white' : 'text-muted-2 hover:text-ink'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      ) : null}

      <ThemeToggle />

      <div className="flex items-center gap-2.5 pl-1.5">
        <Avatar name={user.nickname ?? user.name ?? user.email} size={34} />
        <div className="hidden leading-tight sm:block">
          <div className="text-[13px] font-semibold">
            {user.nickname ?? user.name ?? user.email}
          </div>
          <TierBadge tier={user.effectiveTier} />
        </div>
      </div>
    </header>
  );
}
