'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="mono-tag mt-1 inline-flex items-center gap-1.5 rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-muted-2 transition-colors hover:text-ink"
      aria-label={`Copy ${value}`}
    >
      {copied ? <Check size={11} className="text-teal" /> : <Copy size={11} />}
      {value}
    </button>
  );
}
