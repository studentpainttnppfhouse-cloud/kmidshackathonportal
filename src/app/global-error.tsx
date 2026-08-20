'use client';

import './globals.css';

/**
 * The same fallback for the one case `error.tsx` cannot catch: a throw in the
 * root layout itself, which happens above every route boundary. Next replaces
 * the whole document here, so this file supplies its own html and body.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen items-center justify-center p-6">
          <main className="w-full max-w-[460px] rounded-3xl border border-line bg-surface p-9 text-center shadow-raised">
            <h1 className="text-[19px] font-extrabold tracking-[-0.02em]">
              Hackathon Studio did not start
            </h1>
            <p className="mb-6 mt-2 text-[13.5px] text-muted-2">
              Something failed before any page could render. Whoever runs the portal can check{' '}
              <code className="font-mono">/api/health/supabase</code> for the reason.
            </p>
            <button
              type="button"
              onClick={reset}
              className="rounded-xl px-4 py-2 text-[13px] font-semibold text-white"
              style={{ background: 'var(--pink)' }}
            >
              Try again
            </button>
          </main>
        </div>
      </body>
    </html>
  );
}
