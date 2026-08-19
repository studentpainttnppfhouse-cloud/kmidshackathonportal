'use client';

import { useState } from 'react';
import { Image as ImageIcon, Palette } from 'lucide-react';

export function FilesTabs({
  assets,
  brand,
}: {
  assets: React.ReactNode;
  brand: React.ReactNode;
}) {
  const [tab, setTab] = useState<'assets' | 'brand'>('assets');

  return (
    <div className="mx-auto max-w-[1240px] animate-fadeup">
      <div className="mb-5 inline-flex gap-1 rounded-[11px] border border-line bg-surface p-1">
        <button type="button" onClick={() => setTab('assets')} aria-pressed={tab === 'assets'}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
            tab === 'assets' ? 'bg-pink text-white' : 'text-muted-2 hover:text-ink'
          }`}>
          <ImageIcon size={14} /> Assets
        </button>
        <button type="button" onClick={() => setTab('brand')} aria-pressed={tab === 'brand'}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
            tab === 'brand' ? 'bg-pink text-white' : 'text-muted-2 hover:text-ink'
          }`}>
          <Palette size={14} /> Brand Kit
        </button>
      </div>

      {tab === 'assets' ? assets : brand}
    </div>
  );
}
