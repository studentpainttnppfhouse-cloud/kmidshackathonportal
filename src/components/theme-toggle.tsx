'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * The design ships a dark palette and a toggle for it. The written brief says
 * light-only for v1, so light is the default and the preference is opt-in and
 * remembered per device.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark');
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('hs-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('hs-theme', 'light');
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        role="switch"
        aria-checked={dark}
        aria-label="Dark theme"
        className="relative h-[27px] w-[46px] rounded-full border-0 transition-colors"
        style={{ background: dark ? 'var(--pink)' : 'var(--border-2)' }}
      >
        <span
          className="absolute top-[3px] h-[21px] w-[21px] rounded-full bg-white shadow-sm transition-[left]"
          style={{ left: dark ? '22px' : '3px' }}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Switch to light' : 'Switch to dark'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid h-[38px] w-[38px] place-items-center rounded-md border border-line bg-surface-2 text-ink transition-colors hover:border-pink"
    >
      {dark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
    </button>
  );
}
