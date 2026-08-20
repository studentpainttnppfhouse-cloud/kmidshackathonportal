import { describe, expect, it } from 'vitest';
import {
  cellRef, columnIndex, columnName, formatValue, fromCsv, gridToCells,
  parseRef, toCsv, toGrid,
} from '@/lib/sheet';

describe('A1 addressing', () => {
  it('names columns the way a spreadsheet does', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
    expect(columnName(51)).toBe('AZ');
    expect(columnName(52)).toBe('BA');
  });

  it('round-trips column names', () => {
    for (const i of [0, 1, 25, 26, 27, 51, 52, 700]) {
      expect(columnIndex(columnName(i))).toBe(i);
    }
  });

  it('parses references', () => {
    expect(parseRef('A1')).toEqual({ row: 0, col: 0 });
    expect(parseRef('B10')).toEqual({ row: 9, col: 1 });
    expect(parseRef('AA3')).toEqual({ row: 2, col: 26 });
    expect(parseRef('nonsense')).toBeNull();
  });

  it('builds references', () => {
    expect(cellRef(0, 0)).toBe('A1');
    expect(cellRef(9, 1)).toBe('B10');
  });
});

describe('grid conversion', () => {
  it('expands sparse cells into a dense grid', () => {
    const grid = toGrid({ cells: { A1: 'x', C2: 'y' }, formats: {} }, 3, 3);
    expect(grid[0]?.[0]).toBe('x');
    expect(grid[1]?.[2]).toBe('y');
    expect(grid[2]?.[2]).toBe('');
  });

  it('ignores cells outside the grid rather than throwing', () => {
    const grid = toGrid({ cells: { Z99: 'far away' }, formats: {} }, 2, 2);
    expect(grid).toEqual([['', ''], ['', '']]);
  });

  it('folds a grid back to sparse cells, dropping blanks', () => {
    expect(gridToCells([['a', ''], ['', 'd']])).toEqual({ A1: 'a', B2: 'd' });
  });
});

describe('CSV', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    expect(toCsv([['plain', 'has,comma', 'has"quote', 'has\nnewline']])).toBe(
      'plain,"has,comma","has""quote","has\nnewline"',
    );
  });

  it('parses quoted fields including embedded separators', () => {
    expect(fromCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
    expect(fromCsv('a,"say ""hi""",c')).toEqual([['a', 'say "hi"', 'c']]);
  });

  it('round-trips awkward content', () => {
    const original = [['Sponsor', 'Notes'], ['BDMS', 'Signed, pending "scan"']];
    expect(fromCsv(toCsv(original))).toEqual(original);
  });

  it('handles CRLF line endings from Excel', () => {
    expect(fromCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('value formatting', () => {
  it('formats percentages and currency', () => {
    expect(formatValue(0.425, { numFmt: 'percent' })).toBe('42.5%');
    expect(formatValue(1500, { numFmt: 'currency' })).toContain('1,500');
  });

  it('surfaces formula errors rather than rendering [object Object]', () => {
    expect(formatValue({ type: 'DIV_BY_ZERO', value: '#DIV/0!' })).toBe('#DIV/0!');
  });

  it('trims floating point noise', () => {
    expect(formatValue(0.1 + 0.2)).toBe('0.3');
  });

  it('renders empty for blank cells', () => {
    expect(formatValue('')).toBe('');
    expect(formatValue(null)).toBe('');
  });
});
