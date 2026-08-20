'use client';

import { useEffect, useState } from 'react';
import { formatDate, relativeTime } from '@/lib/format';

/**
 * A relative timestamp that does not break hydration.
 *
 * "13m ago" computed during SSR and again in the browser disagree the moment a
 * minute boundary falls between them, which React reports as a hydration
 * mismatch. So the first paint on both sides renders the same deterministic
 * absolute date, and the relative form is swapped in after mount — then kept
 * fresh, which the plain function could not do anyway.
 */
export function TimeAgo({ iso, className }: { iso: string | null; className?: string }) {
  const [label, setLabel] = useState(() => formatDate(iso));

  useEffect(() => {
    if (!iso) return undefined;
    const update = () => setLabel(relativeTime(iso));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [iso]);

  if (!iso) return <span className={className}>—</span>;

  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString('en-GB')} className={className}>
      {label}
    </time>
  );
}
