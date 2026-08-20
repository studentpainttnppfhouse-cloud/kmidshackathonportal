'use client';

import { TriangleAlert } from 'lucide-react';

/**
 * What a route shows when it throws.
 *
 * Without this, Next serves its own "a server-side exception has occurred"
 * digest, which tells whoever is looking at it nothing at all. This is not a
 * gate — it renders only when a route has actually failed, so a healthy
 * deployment never reaches it.
 *
 * It deliberately does not name environment variables: this page is reachable
 * by anyone. `/api/health/supabase` is where the specifics live.
 */
export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <main className="w-full max-w-[460px] rounded-3xl border border-line bg-surface p-9 text-center shadow-raised">
        <div
          className="mx-auto mb-5 grid h-[52px] w-[52px] place-items-center rounded-full"
          style={{ background: 'var(--surface-2)', color: 'var(--pink)' }}
        >
          <TriangleAlert size={24} strokeWidth={1.75} />
        </div>

        <h1 className="text-[19px] font-extrabold tracking-[-0.02em]">This page did not load</h1>
        <p className="mb-6 mt-2 text-[13.5px] text-muted-2">
          Something failed on the server. Trying again is worth a shot — if it keeps happening,
          whoever runs the portal can check <code className="font-mono">/api/health/supabase</code>{' '}
          for the reason.
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
  );
}
