'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HyperFormula } from 'hyperformula';
import {
  Bold, Italic, AlignLeft, AlignCenter, AlignRight, Check, Loader2, CloudOff,
  Download, Upload, Undo2, Redo2,
} from 'lucide-react';
import {
  DEFAULT_COLS, DEFAULT_ROWS, cellRef, columnName, formatValue, fromCsv,
  gridToCells, toCsv, toGrid, type CellFormat, type SheetData,
} from '@/lib/sheet';
import { saveSheetAction } from './actions';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

const AUTOSAVE_DELAY_MS = 1000;

/**
 * The grid.
 *
 * HyperFormula owns evaluation — SUM, AVERAGE, COUNT, COUNTA, MIN, MAX, IF,
 * AND, OR, CONCATENATE, VLOOKUP, ranges and arithmetic all come from it, so
 * there is no hand-rolled formula parser anywhere in this codebase.
 */
export function SheetGrid({
  sheetId,
  initialData,
  editable,
}: {
  sheetId: string;
  initialData: SheetData;
  editable: boolean;
}) {
  const rows = initialData.rows ?? DEFAULT_ROWS;
  const cols = initialData.cols ?? DEFAULT_COLS;

  const [cells, setCells] = useState<Record<string, string>>(initialData.cells ?? {});
  const [formats, setFormats] = useState<Record<string, CellFormat>>(initialData.formats ?? {});
  const [selected, setSelected] = useState<string>('A1');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, string>[]>([]);
  const [future, setFuture] = useState<Record<string, string>[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Rebuilt whenever a cell changes. For a sheet of this size that is cheap
  // and avoids having to keep an incremental engine in sync by hand.
  const engine = useMemo(() => {
    const grid = toGrid({ cells, formats }, rows, cols);
    return HyperFormula.buildFromArray(grid, {
      licenseKey: 'gpl-v3',
      useColumnIndex: true,
    });
  }, [cells, formats, rows, cols]);

  useEffect(() => () => engine.destroy(), [engine]);

  const scheduleSave = useCallback(
    (nextCells: Record<string, string>, nextFormats: Record<string, CellFormat>) => {
      if (!editable) return;
      setSaveState('dirty');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        setSaveState('saving');
        setError(null);
        const res = await saveSheetAction(sheetId, {
          cells: nextCells,
          formats: nextFormats,
          rows,
          cols,
        });
        if (res.ok) setSaveState('saved');
        else {
          setSaveState('error');
          setError(res.error);
        }
      }, AUTOSAVE_DELAY_MS);
    },
    [editable, sheetId, rows, cols],
  );

  const commit = useCallback(
    (next: Record<string, string>) => {
      setHistory((h) => [...h.slice(-49), cells]);
      setFuture([]);
      setCells(next);
      scheduleSave(next, formats);
    },
    [cells, formats, scheduleSave],
  );

  function setCell(ref: string, value: string) {
    const next = { ...cells };
    if (value === '') delete next[ref];
    else next[ref] = value;
    commit(next);
  }

  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      if (!prev) return h;
      setFuture((f) => [cells, ...f]);
      setCells(prev);
      scheduleSave(prev, formats);
      return h.slice(0, -1);
    });
  }

  function redo() {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      if (!next) return f;
      setHistory((h) => [...h, cells]);
      setCells(next);
      scheduleSave(next, formats);
      return f.slice(1);
    });
  }

  function applyFormat(patch: CellFormat) {
    const next = { ...formats, [selected]: { ...formats[selected], ...patch } };
    setFormats(next);
    scheduleSave(cells, next);
  }

  function displayValue(row: number, col: number): string {
    const ref = cellRef(row, col);
    const raw = cells[ref];
    if (raw === undefined) return '';
    // Non-formula cells render as typed, so text is never coerced.
    if (!raw.startsWith('=')) return raw;
    try {
      const value = engine.getCellValue({ sheet: 0, row, col });
      return formatValue(value, formats[ref]);
    } catch {
      return '#ERROR!';
    }
  }

  function exportCsv() {
    const grid: string[][] = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => displayValue(r, c)),
    );
    // Trim the trailing empty rows and columns nobody wants in their export.
    const lastRow = grid.reduce((acc, row, i) => (row.some((v) => v !== '') ? i : acc), -1);
    const lastCol = grid.reduce(
      (acc, row) => Math.max(acc, row.reduce((a, v, i) => (v !== '' ? i : a), -1)),
      -1,
    );
    const trimmed = grid.slice(0, lastRow + 1).map((r) => r.slice(0, lastCol + 1));

    const blob = new Blob([toCsv(trimmed)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sheet.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file: File) {
    const text = await file.text();
    commit(gridToCells(fromCsv(text)));
  }

  const selFormat = formats[selected] ?? {};

  return (
    <div className="card overflow-hidden">
      {editable ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-3 py-2">
          <ToolButton icon={Undo2} label="Undo" onClick={undo} disabled={history.length === 0} />
          <ToolButton icon={Redo2} label="Redo" onClick={redo} disabled={future.length === 0} />
          <Divider />
          <ToolButton icon={Bold} label="Bold" active={selFormat.bold}
            onClick={() => applyFormat({ bold: !selFormat.bold })} />
          <ToolButton icon={Italic} label="Italic" active={selFormat.italic}
            onClick={() => applyFormat({ italic: !selFormat.italic })} />
          <Divider />
          <ToolButton icon={AlignLeft} label="Align left" active={selFormat.align === 'left'}
            onClick={() => applyFormat({ align: 'left' })} />
          <ToolButton icon={AlignCenter} label="Align centre" active={selFormat.align === 'center'}
            onClick={() => applyFormat({ align: 'center' })} />
          <ToolButton icon={AlignRight} label="Align right" active={selFormat.align === 'right'}
            onClick={() => applyFormat({ align: 'right' })} />
          <Divider />
          <select
            aria-label="Number format"
            value={selFormat.numFmt ?? 'plain'}
            onChange={(e) => applyFormat({ numFmt: e.target.value as CellFormat['numFmt'] })}
            className="h-8 rounded-md border border-line-2 bg-surface px-2 text-[12px]"
          >
            <option value="plain">Plain</option>
            <option value="number">Number</option>
            <option value="currency">Currency</option>
            <option value="percent">Percent</option>
            <option value="date">Date</option>
          </select>
          <div className="flex-1" />
          <button type="button" onClick={() => fileInput.current?.click()} className="btn-quiet py-1.5">
            <Upload size={13} /> Import CSV
          </button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importCsv(f);
              e.target.value = '';
            }} />
          <button type="button" onClick={exportCsv} className="btn-quiet py-1.5">
            <Download size={13} /> Export CSV
          </button>
        </div>
      ) : null}

      {/* Formula bar */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="mono-tag w-14 shrink-0 text-muted-2">{selected}</span>
        <span className="h-4 w-px bg-line" />
        <input
          value={editing === selected ? draft : cells[selected] ?? ''}
          disabled={!editable}
          onChange={(e) => {
            setEditing(selected);
            setDraft(e.target.value);
          }}
          onBlur={() => {
            if (editing === selected) setCell(selected, draft);
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setCell(selected, draft);
              setEditing(null);
            }
          }}
          placeholder="Type a value, or =SUM(A1:A10)"
          aria-label="Formula bar"
          className="w-full border-0 bg-transparent font-mono text-[13px] text-ink outline-none"
        />
      </div>

      <div className="overflow-auto" style={{ maxHeight: '68vh' }}>
        <table className="border-collapse text-[13px]" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 w-11 border border-line bg-surface-2" />
              {Array.from({ length: cols }, (_, c) => (
                <th
                  key={c}
                  className="sticky top-0 z-10 border border-line bg-surface-2 px-2 py-1 text-[11px] font-bold text-muted-2"
                  style={{ minWidth: 96, width: 96 }}
                >
                  {columnName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                <th className="sticky left-0 z-10 border border-line bg-surface-2 px-1 text-[11px] font-bold text-muted-2">
                  {r + 1}
                </th>
                {Array.from({ length: cols }, (_, c) => {
                  const ref = cellRef(r, c);
                  const fmt = formats[ref] ?? {};
                  const isSelected = selected === ref;
                  const isEditing = editing === ref;

                  return (
                    <td
                      key={ref}
                      onClick={() => {
                        setSelected(ref);
                        setEditing(null);
                      }}
                      onDoubleClick={() => {
                        if (!editable) return;
                        setSelected(ref);
                        setDraft(cells[ref] ?? '');
                        setEditing(ref);
                      }}
                      className="border border-line p-0"
                      style={{
                        outline: isSelected ? '2px solid var(--pink)' : undefined,
                        outlineOffset: '-2px',
                        background: fmt.bg ?? 'var(--surface)',
                      }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => {
                            setCell(ref, draft);
                            setEditing(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setCell(ref, draft);
                              setEditing(null);
                              setSelected(cellRef(Math.min(r + 1, rows - 1), c));
                            }
                            if (e.key === 'Escape') setEditing(null);
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              setCell(ref, draft);
                              setEditing(null);
                              setSelected(cellRef(r, Math.min(c + 1, cols - 1)));
                            }
                          }}
                          className="h-7 w-full border-0 bg-surface px-1.5 font-mono text-[12.5px] text-ink outline-none"
                          aria-label={`Cell ${ref}`}
                        />
                      ) : (
                        <div
                          className="h-7 truncate px-1.5 leading-7"
                          style={{
                            fontWeight: fmt.bold ? 700 : 400,
                            fontStyle: fmt.italic ? 'italic' : undefined,
                            textAlign: fmt.align ?? (typeof cells[ref] === 'string' && cells[ref]?.startsWith('=') ? 'right' : 'left'),
                            color: fmt.color ?? 'var(--text)',
                          }}
                        >
                          {displayValue(r, c)}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-surface-2 px-5 py-2.5 text-[12px] font-semibold">
        {saveState === 'saving' ? (
          <span className="flex items-center gap-1.5 text-muted-2">
            <Loader2 size={13} className="animate-[spin_1s_linear_infinite]" /> Saving…
          </span>
        ) : saveState === 'dirty' ? (
          <span className="text-muted-2">Unsaved changes</span>
        ) : saveState === 'error' ? (
          <span className="flex items-center gap-1.5 text-danger">
            <CloudOff size={13} /> Not saved
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-teal">
            <Check size={13} /> All changes saved
          </span>
        )}
        {error ? <span className="text-danger">{error}</span> : null}
        <span className="ml-auto text-muted-2">
          {Object.keys(cells).length} filled {Object.keys(cells).length === 1 ? 'cell' : 'cells'}
        </span>
      </div>
    </div>
  );
}

function ToolButton({
  icon: Icon, label, onClick, active, disabled,
}: {
  icon: typeof Bold;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md transition-colors disabled:opacity-35 ${
        active ? 'bg-pink text-white' : 'text-muted-2 hover:bg-surface-3 hover:text-ink'
      }`}
    >
      <Icon size={15} strokeWidth={2} />
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line" />;
}
