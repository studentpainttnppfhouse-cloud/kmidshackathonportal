'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteSheetAction, renameSheetAction } from './actions';

export function SheetHeader({
  sheetId,
  title,
  departmentName,
  editable,
}: {
  sheetId: string;
  title: string;
  departmentName: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <input
        value={value}
        disabled={!editable}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim() === title || !value.trim()) return;
          start(async () => {
            const res = await renameSheetAction(sheetId, value);
            if (!res.ok) setError(res.error);
          });
        }}
        aria-label="Spreadsheet title"
        className="min-w-[220px] flex-1 border-0 bg-transparent text-[22px] font-extrabold tracking-[-0.02em] text-ink outline-none"
      />

      <span className="rounded-md bg-surface-3 px-2.5 py-1 text-[11.5px] font-bold text-deep">
        {departmentName}
      </span>

      {editable ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm('Move this spreadsheet to the recycle bin?')) return;
            start(async () => {
              const res = await deleteSheetAction(sheetId);
              if (res.ok) router.push('/spreadsheets');
              else setError(res.error);
            });
          }}
          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-danger"
        >
          <Trash2 size={13} /> Delete
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="w-full rounded-md bg-danger-soft px-3 py-2 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
