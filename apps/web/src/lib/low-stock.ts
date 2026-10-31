export interface StockLevel { productId: string; stock: number; reserved: number; available: number; reorderLevel: number | null }
/** A product is low when the shop set a minimum and what can still be sold is at or below it. No minimum means not tracked. */
export const isLowStock = (row: Pick<StockLevel, 'available' | 'reorderLevel'>) => row.reorderLevel !== null && row.available <= row.reorderLevel;
/** Lowest relative stock first, so the most urgent restock comes first; ties keep the server order. */
export function lowStockRows<T extends StockLevel>(rows: readonly T[]) {
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => isLowStock(row))
    .sort((a, b) => (a.row.available - a.row.reorderLevel!) - (b.row.available - b.row.reorderLevel!) || a.index - b.index).map(({ row }) => row);
}
