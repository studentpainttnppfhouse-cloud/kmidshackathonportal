'use client';

import { useTransition } from 'react';
import { signOutAction } from '@/app/signin/actions';

export function SignOutButton({
  children,
  className = 'btn-tertiary',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => start(() => void signOutAction())}
    >
      {children}
    </button>
  );
}
