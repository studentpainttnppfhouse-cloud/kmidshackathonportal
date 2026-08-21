import { KeyRound } from 'lucide-react';
import type { EnvProblem } from '@/lib/env';

/**
 * The screen a misconfigured deployment shows instead of Next's generic
 * "a server-side exception has occurred" digest.
 *
 * Nothing here reads the database or the session — every one of those paths
 * needs the very variables that are missing — so this renders from the
 * problem list alone.
 */
export function SetupRequired({ problems }: { problems: EnvProblem[] }) {
  const onVercel = Boolean(process.env.VERCEL);

  return (
    <div
      className="flex min-h-screen items-center justify-center p-6"
      style={{
        background:
          'radial-gradient(120% 90% at 50% -10%, var(--surface) 0%, var(--wash) 55%, var(--surface-3) 100%)',
      }}
    >
      <main className="w-full max-w-[620px] rounded-3xl border border-line bg-surface p-9 shadow-raised">
        <div
          className="mb-5 grid h-[60px] w-[60px] place-items-center rounded-full"
          style={{ background: 'var(--surface-2)', color: 'var(--pink)' }}
        >
          <KeyRound size={26} strokeWidth={1.75} />
        </div>

        <h1 className="text-[21px] font-extrabold tracking-[-0.02em]">Finish setting up</h1>
        <p className="mb-6 mt-2 text-muted-2">
          Hackathon Studio is deployed, but it cannot reach its database yet. Set the{' '}
          {problems.length === 1 ? 'variable' : `${problems.length} variables`} below, then
          redeploy.
        </p>

        <ul className="mb-6 space-y-2.5">
          {problems.map((p) => (
            <li key={p.key} className="rounded-xl border border-line bg-surface-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <code className="font-mono text-[13px] font-semibold">{p.key}</code>
                <span className="text-[12px] text-danger">{p.reason}</span>
              </div>
              {p.source ? <p className="mt-1 text-[12.5px] text-muted-2">{p.source}</p> : null}
              {p.alsoAccepts.length > 0 ? (
                <p className="mt-1 text-[12px] text-muted">
                  Also read from{' '}
                  {p.alsoAccepts.map((name, i) => (
                    <span key={name}>
                      {i > 0 ? ', ' : ''}
                      <code className="font-mono">{name}</code>
                    </span>
                  ))}
                  .
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3.5">
          <h2 className="mb-1.5 text-[13px] font-bold">
            {onVercel ? 'On Vercel' : 'Running locally'}
          </h2>
          {onVercel ? (
            <ol className="list-decimal space-y-1 pl-4 text-[12.5px] text-muted-2">
              <li>
                Install the <strong>AWS</strong> integration on this project. It sets{' '}
                <code className="font-mono">AWS_ROLE_ARN</code> and{' '}
                <code className="font-mono">AWS_REGION</code>, which is what lets the deployment
                reach Aurora and S3 without a stored password.
              </li>
              <li>
                Add the rest by hand under Settings → Environment Variables, for Production,
                Preview and Development — the cluster endpoint, the database name, the database
                user, the bucket, and the <code className="font-mono">OWNER_</code> addresses.
              </li>
              <li>
                Run <code className="font-mono">npm run db:aurora</code> once, from a machine that
                can reach the cluster, to create the schema and the roles.
              </li>
              <li>
                Deployments → ⋯ → <strong>Redeploy</strong>. Saving a variable does not change a
                deployment that already exists.
              </li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 pl-4 text-[12.5px] text-muted-2">
              <li>
                Copy <code className="font-mono">.env.example</code> to{' '}
                <code className="font-mono">.env.local</code> and fill it in.
              </li>
              <li>
                Run <code className="font-mono">npm run db:aurora</code> to create the schema, the
                roles and the Owner accounts.
              </li>
              <li>Restart the dev server.</li>
            </ol>
          )}
        </div>

        <p className="mono-tag mt-5 rounded-md px-2 py-2 text-center" style={{ background: 'var(--surface-2)', color: 'var(--teal)' }}>
          STATUS: AWAITING CONFIGURATION
        </p>
      </main>
    </div>
  );
}
