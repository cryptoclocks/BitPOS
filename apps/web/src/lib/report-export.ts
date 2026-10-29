// Server-built CSV exports (GET /api/reports/export). The server owns the rows, role check, merchant scope, formula guard and
// integer minor units; this module only walks the pages and joins them. Nothing is recomputed on the device.
export type ExportKind = 'sales' | 'net' | 'stock';
export interface ExportPage { csv: string; rows: number; nextCursor: string | null; filename: string }
export const maxExportPages = 200;
export async function collectExport(fetchPage: (cursor: string) => Promise<ExportPage>): Promise<{ csv: string; filename: string; rows: number }> {
  let cursor = '', csv = '', rows = 0, filename = '';
  for (let pages = 0; pages < maxExportPages; pages++) {
    const page = await fetchPage(cursor);
    csv += page.csv; rows += page.rows; filename = page.filename;
    if (!page.nextCursor) return { csv: '﻿' + csv, filename, rows };
    if (page.nextCursor === cursor) throw new Error('Export cursor did not advance');
    cursor = page.nextCursor;
  }
  throw new Error('Export is too large for one download; choose a shorter range');
}
export const exportPath = (kind: ExportKind, from: string, to: string, cursor: string) => `/reports/export?kind=${kind}&from=${from}&to=${to}${cursor ? `&cursor=${cursor}` : ''}`;
