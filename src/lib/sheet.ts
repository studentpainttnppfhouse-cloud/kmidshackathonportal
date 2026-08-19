/**
 * Spreadsheet data model and A1 addressing.
 *
 * Cells are stored sparsely as { "A1": "=SUM(B1:B9)" } so an empty grid costs
 * nothing. Formulas are kept as authored text; HyperFormula evaluates them in
 * the browser, which is why the database never needs a formula parser.
 */

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  numFmt?: 'plain' | 'number' | 'currency' | 'percent' | 'date';
  bg?: string;
  color?: string;
}

export interface SheetData {
  cells: Record<string, string>;
  formats: Record<string, CellFormat>;
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
  frozenRows?: number;
  frozenCols?: number;
  rows?: number;
  cols?: number;
}

export const DEFAULT_ROWS = 60;
export const DEFAULT_COLS = 16;

export function emptySheet(): SheetData {
  return { cells: {}, formats: {}, rows: DEFAULT_ROWS, cols: DEFAULT_COLS };
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnName(index: number): string {
  let n = index;
  let name = '';
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function cellRef(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

export function parseRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!match || !match[1] || !match[2]) return null;
  return { col: columnIndex(match[1]), row: Number(match[2]) - 1 };
}

/** Convert the sparse map into the dense array HyperFormula wants. */
export function toGrid(data: SheetData, rows: number, cols: number): string[][] {
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ''),
  );
  for (const [ref, value] of Object.entries(data.cells)) {
    const pos = parseRef(ref);
    if (!pos) continue;
    if (pos.row >= rows || pos.col >= cols || pos.row < 0 || pos.col < 0) continue;
    const row = grid[pos.row];
    if (row) row[pos.col] = value;
  }
  return grid;
}

/** Render an evaluated value for display, honouring the cell's number format. */
export function formatValue(value: unknown, format?: CellFormat): string {
  if (value === null || value === undefined || value === '') return '';

  if (typeof value === 'object' && value !== null && 'type' in value) {
    // HyperFormula returns a DetailedCellError for #DIV/0!, #REF! and friends.
    const err = value as { value?: string; type?: string };
    return err.value ?? `#${err.type ?? 'ERROR'}!`;
  }

  if (typeof value === 'number') {
    switch (format?.numFmt) {
      case 'currency':
        return new Intl.NumberFormat('en-GB', {
          style: 'currency',
          currency: 'THB',
          maximumFractionDigits: 2,
        }).format(value);
      case 'percent':
        return `${(value * 100).toFixed(1)}%`;
      case 'number':
        return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
      case 'date': {
        // HyperFormula serial dates count from 30 Dec 1899, like Excel.
        const ms = (value - 25569) * 86_400_000;
        return new Date(ms).toLocaleDateString('en-GB');
      }
      default:
        return String(Math.round(value * 1e10) / 1e10);
    }
  }

  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** Convert the grid to CSV, quoting anything that needs it. */
export function toCsv(values: string[][]): string {
  return values
    .map((row) =>
      row
        .map((cell) => {
          if (cell === '') return '';
          if (/[",\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
          return cell;
        })
        .join(','),
    )
    .join('\n');
}

/** Parse CSV, handling quoted fields and embedded newlines. */
export function fromCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Fold a dense grid back into the sparse cell map. */
export function gridToCells(grid: string[][]): Record<string, string> {
  const cells: Record<string, string> = {};
  grid.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== '' && value !== undefined) cells[cellRef(r, c)] = value;
    });
  });
  return cells;
}
