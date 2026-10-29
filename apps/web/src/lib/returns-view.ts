export interface ReturnRow { caseId: string; orderId: string; reason: string; requestedAt: string; receivedAt: string | null; resolvedAt: string | null; condition: string | null; amount: { currency: string; decimals: number; totalMinor: string } | null; refund: 'NONE' | 'IN_PROGRESS' | 'REFUNDED'; stage: 'REQUESTED' | 'RECEIVED' | 'RESOLVED' | 'REFUNDING' | 'REFUNDED' }
export type ReturnFilter = 'all' | 'open' | 'refunded';
/** Stages that still need someone to act or wait: everything short of a finalized refund. */
export const isOpenReturn = (row: ReturnRow) => row.stage !== 'REFUNDED';
/** Search by the short order reference, the case id or the reason text; the filter is applied first. */
export function filterReturns(rows: readonly ReturnRow[], filter: ReturnFilter, search: string) {
  const needle = search.trim().toLowerCase();
  return rows.filter(row => (filter === 'all' || (filter === 'open' ? isOpenReturn(row) : !isOpenReturn(row)))
    && (!needle || row.orderId.slice(0, 8).toLowerCase().includes(needle) || row.caseId.toLowerCase().startsWith(needle) || row.reason.toLowerCase().includes(needle)));
}
