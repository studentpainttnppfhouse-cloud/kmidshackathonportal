import type { Config } from 'tailwindcss';

/**
 * Design tokens from §7 of the build brief, wired through CSS custom
 * properties so the whole palette can be swapped by `[data-theme]`
 * without every utility class needing a `dark:` variant.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        ink: 'var(--text)',
        muted: {
          DEFAULT: 'var(--muted)',
          2: 'var(--muted-2)',
        },
        pink: 'var(--pink)',
        deep: 'var(--deep)',
        teal: 'var(--teal)',
        line: {
          DEFAULT: 'var(--border)',
          2: 'var(--border-2)',
        },
        wash: 'var(--wash)',
        danger: 'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
        warn: 'var(--warn)',
        success: 'var(--success)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '16px',
        '3xl': '20px',
      },
      boxShadow: {
        card: 'var(--shadow-sm)',
        raised: 'var(--shadow)',
        drawer: '-10px 0 40px rgba(190,60,120,.15)',
      },
      keyframes: {
        ecgdash: { to: { strokeDashoffset: '-1000' } },
        ecgpulse: {
          '0%,100%': { opacity: '.35' },
          '50%': { opacity: '1' },
        },
        fadeup: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        spin: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        ecgdash: 'ecgdash 6s linear infinite',
        ecgpulse: 'ecgpulse 1.5s infinite',
        fadeup: 'fadeup .3s ease',
        'fadeup-fast': 'fadeup .2s ease',
      },
    },
  },
  plugins: [],
};

export default config;
