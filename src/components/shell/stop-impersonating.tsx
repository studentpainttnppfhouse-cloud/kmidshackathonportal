'use client';

import { useTransition } from 'react';
import { setViewAsAction } from './impersonation';

export function StopImpersonatingButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => void setViewAsAction(null))}
      className="ml-auto rounded-md bg-pink px-3 py-1.5 text-[12px] font-semibold text-white"
    >
      Exit preview
    </button>
  );
}
