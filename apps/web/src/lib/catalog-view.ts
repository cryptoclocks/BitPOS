import type { Product } from './menu';

export type CatalogStatus = 'on_sale' | 'sold_out' | 'price_missing';
// Status comes only from fields the menu read already returns; nothing is inferred.
export function catalogStatus(product: Pick<Product, 'unitPrice' | 'available'>): CatalogStatus {
  if (!product.unitPrice) return 'price_missing';
  return product.available > 0 ? 'on_sale' : 'sold_out';
}
export function filterCatalog<T extends Pick<Product, 'name' | 'nameEn' | 'category' | 'description'>>(products: T[], query: string, category: string): T[] {
  const needle = query.trim().toLowerCase();
  return products.filter(product => (!category || product.category === category) && (!needle || `${product.name} ${product.nameEn} ${product.category} ${product.description}`.toLowerCase().includes(needle)));
}
export function categorySummary(products: Pick<Product, 'category'>[]): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const product of products) counts.set(product.category || '', (counts.get(product.category || '') ?? 0) + 1);
  return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));
}
