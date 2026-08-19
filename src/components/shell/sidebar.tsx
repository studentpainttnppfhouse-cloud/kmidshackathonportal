'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Lock, Settings } from 'lucide-react';
import type { Tier } from '@/lib/types';
import { navItems } from './nav-items';

export function Sidebar({
  tier,
  onNavigate,
}: {
  tier: Tier;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = navItems(tier);

  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line px-[18px] pb-3.5 pt-[18px]">
        <div className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-pink text-white">
          <Heart size={20} strokeWidth={1.75} />
        </div>
        <div>
          <div className="text-[14px] font-extrabold leading-none tracking-[-0.02em]">
            Hackathon Studio
          </div>
          <div className="mono-tag mt-[3px] text-muted">KMIDS · 2027</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-5 pt-2.5" aria-label="Main">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          if (item.locked) {
            return (
              <span
                key={item.href}
                aria-disabled="true"
                title="Owner only"
                className="mb-0.5 flex w-full cursor-not-allowed items-center gap-[11px] rounded-md px-3 py-2.5 text-[13.5px] font-medium text-muted opacity-60"
              >
                <Icon size={18} strokeWidth={1.75} />
                <span className="flex-1 text-left">{item.label}</span>
                <Lock size={13} strokeWidth={2} />
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`mb-0.5 flex w-full items-center gap-[11px] rounded-md px-3 py-2.5 text-[13.5px] transition-colors ${
                active
                  ? 'bg-surface-3 font-bold text-deep'
                  : 'font-medium text-muted-2 hover:bg-surface-2'
              }`}
            >
              <Icon size={18} strokeWidth={1.75} />
              <span className="flex-1 text-left">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-[13px] font-medium text-muted-2 transition-colors hover:bg-surface-2"
        >
          <Settings size={18} strokeWidth={1.75} />
          Settings
        </Link>
      </div>
    </aside>
  );
}
