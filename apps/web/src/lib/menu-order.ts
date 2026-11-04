// M02: pure ordering helpers for the menu order panel. The server owns the order; these only compute the proposal that is sent back.
export function categoryOrder(products: { category: string }[]): string[] {
  return [...new Set(products.map(p => p.category))];
}
/** Swap `item` with its neighbour in `list`; returns null at the ends or when absent. */
export function moveItem<T>(list: T[], item: T, direction: -1 | 1): T[] | null {
  const from = list.indexOf(item), to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return null;
  const next = [...list];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
/** Move a product past its nearest neighbour; with `category` set, the neighbour is the nearest product of the same category. */
export function moveProduct(products: { id: string; category: string }[], id: string, direction: -1 | 1, category?: string): string[] | null {
  const ids = products.map(p => p.id), from = ids.indexOf(id);
  if (from < 0) return null;
  const same = (i: number) => category === undefined || products[i]!.category === category;
  let to = from + direction;
  while (to >= 0 && to < ids.length && !same(to)) to += direction;
  if (to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
