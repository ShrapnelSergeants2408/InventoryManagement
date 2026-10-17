// Shared CSV plumbing: header-name matching (SPEC §7), row numbers as a spreadsheet shows them.
import Papa from 'papaparse';

export interface FileProblem {
  file: string;
  /** Spreadsheet row number (header = 1), or null for a whole-file problem. */
  row: number | null;
  message: string;
}

export interface CsvTable {
  /** Normalized header (trimmed, lower-case) → column index. */
  columns: Map<string, number>;
  /** Headers as written, in file order. */
  headers: string[];
  /** Data rows with their spreadsheet row numbers; fully blank rows are skipped. */
  rows: { row: number; cells: string[] }[];
  problems: FileProblem[];
}

export const BOM = '﻿';

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

export function readCsv(text: string, file: string): CsvTable {
  const problems: FileProblem[] = [];
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { header: false, skipEmptyLines: false });
  for (const e of parsed.errors) {
    // Papa reports a trailing-newline "row" as UndetectableDelimiter on one-column files; that's harmless.
    if (e.code === 'UndetectableDelimiter') continue;
    problems.push({ file, row: e.row === undefined ? null : e.row + 1, message: `CSV format problem: ${e.message}` });
  }
  const records = parsed.data;
  const headers = (records[0] ?? []).map((h) => h.trim());
  const columns = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (key === '') return;
    if (columns.has(key)) problems.push({ file, row: 1, message: `column "${h}" appears more than once` });
    else columns.set(key, i);
  });
  const rows: CsvTable['rows'] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i] ?? [];
    if (cells.every((c) => c.trim() === '')) continue;
    rows.push({ row: i + 1, cells });
  }
  return { columns, headers, rows, problems };
}

/** Cell accessor by normalized header; missing column or cell → ''. */
export function cellGetter(table: CsvTable, cells: string[]): (header: string) => string {
  return (header) => {
    const i = table.columns.get(header);
    return i === undefined ? '' : (cells[i] ?? '');
  };
}

/** CSV text with a BOM (so Excel reads UTF-8 names like "10-32 × ¾") and CRLF line ends. */
export function writeCsv(fields: readonly string[], data: readonly (readonly string[])[]): string {
  return BOM + Papa.unparse({ fields: [...fields], data: data.map((r) => [...r]) }, { newline: '\r\n' }) + '\r\n';
}

/**
 * US spreadsheet dates (10/17/2026) become ISO (2026-10-17); ISO passes through.
 * Returns null when the text isn't a recognizable date.
 */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return null;
}
