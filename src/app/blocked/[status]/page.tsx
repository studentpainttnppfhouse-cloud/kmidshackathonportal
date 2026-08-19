import { notFound, redirect } from 'next/navigation';
import { Clock, Ban, ShieldAlert, MailCheck } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/session';
import { EcgLine } from '@/components/ecg';
import { SignOutButton } from '@/components/sign-out-button';

export const dynamic = 'force-dynamic';

/**
 * Blocked accounts get a screen that says exactly what is going on, never a
 * generic error (§3). Suspended and banned users land here after their
 * sessions are revoked.
 */
const SCREENS = {
  requested: {
    icon: Clock,
    tone: 'pink' as const,
    title: 'Access requested',
    body: "Your request is with the event Owner. You'll get an email the moment you're approved — usually within a day.",
    status: 'WAITING FOR APPROVAL',
  },
  pending: {
    icon: MailCheck,
    tone: 'pink' as const,
    title: 'Invitation pending',
    body: "You've been invited but your account hasn't been activated yet. Try signing in again shortly, or check with your department head.",
    status: 'INVITE NOT YET ACTIVE',
  },
  suspended: {
    icon: ShieldAlert,
    tone: 'danger' as const,
    title: 'Account suspended',
    body: 'Your access has been paused by an administrator. If you think this is a mistake, contact your department head or the event Owner.',
    status: 'SUSPENDED',
  },
  banned: {
    icon: Ban,
    tone: 'danger' as const,
    title: 'Account closed',
    body: 'Your access to Hackathon Studio has been permanently removed. Contact the event Owner if you believe this is an error.',
    status: 'ACCESS REVOKED',
  },
} as const;

type BlockStatus = keyof typeof SCREENS;

function isBlockStatus(v: string): v is BlockStatus {
  return v in SCREENS;
}

export default async function BlockedPage({
  params,
}: {
  params: Promise<{ status: string }>;
}) {
  const { status } = await params;
  if (!isBlockStatus(status)) notFound();

  const user = await getSessionUser();
  // Someone whose suspension was lifted should not be stuck looking at this.
  if (user?.status === 'active') redirect('/dashboard');

  const screen = SCREENS[status];
  const Icon = screen.icon;
  const danger = screen.tone === 'danger';

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
      style={{
        background:
          'radial-gradient(120% 90% at 50% -10%, var(--surface) 0%, var(--wash) 55%, var(--surface-3) 100%)',
      }}
    >
      <div className="absolute inset-x-0 top-0 opacity-40">
        <EcgLine width={1200} height={90} />
      </div>

      <div className="relative w-full max-w-[420px] animate-fadeup rounded-3xl border border-line bg-surface p-9 text-center shadow-raised">
        <div
          className="mx-auto mb-5 mt-1.5 grid h-[60px] w-[60px] place-items-center rounded-full"
          style={{
            background: danger ? 'var(--danger-soft)' : 'var(--surface-2)',
            color: danger ? 'var(--danger)' : 'var(--pink)',
          }}
        >
          <Icon size={26} strokeWidth={1.75} />
        </div>

        <h1 className="text-[21px] font-extrabold tracking-[-0.02em]">{screen.title}</h1>
        <p className="mb-6 mt-2 text-muted-2">{screen.body}</p>

        {user?.ban_reason && status === 'banned' ? (
          <p className="mb-4 rounded-md bg-danger-soft px-3 py-2.5 text-left text-[12.5px] text-danger">
            <strong>Reason:</strong> {user.ban_reason}
          </p>
        ) : null}

        <div
          className="mono-tag rounded-md px-2 py-2"
          style={{
            background: danger ? 'var(--danger-soft)' : 'var(--surface-2)',
            color: danger ? 'var(--danger)' : 'var(--teal)',
          }}
        >
          STATUS: {screen.status}
        </div>

        {user ? (
          <p className="mt-4 text-[12px] text-muted">Signed in as {user.email}</p>
        ) : null}

        <SignOutButton className="btn-tertiary mt-4 w-full">← Back to sign-in</SignOutButton>
      </div>
    </div>
  );
}
