import { TIER_META, type Tier } from '@/lib/types';

export function TierBadge({ tier, className = '' }: { tier: Tier; className?: string }) {
  const meta = TIER_META[tier];
  return (
    <span
      className={`mono-tag inline-flex items-center rounded-[6px] px-[7px] py-px text-white ${className}`}
      style={{ background: meta.color }}
      title={meta.short}
    >
      {meta.label}
    </span>
  );
}
