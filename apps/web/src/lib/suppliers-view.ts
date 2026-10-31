export interface SupplierRow { id: string; name: string; supplies: string; contact: string; phone: string; active: boolean; version: number; createdAt: string; updatedAt: string }
export type SupplierFilter = 'all' | 'active' | 'inactive';
/** The status filter applies first; the search matches the name, what they supply, the contact person and the phone. */
export function filterSuppliers(rows: readonly SupplierRow[], filter: SupplierFilter, search: string) {
  const needle = search.trim().toLowerCase();
  return rows.filter(row => (filter === 'all' || (filter === 'active') === row.active)
    && (!needle || [row.name, row.supplies, row.contact, row.phone].some(value => value.toLowerCase().includes(needle))));
}
