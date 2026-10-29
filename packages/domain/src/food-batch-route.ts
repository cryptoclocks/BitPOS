/** Pure route planning only: this never assigns work or promises a road ETA. */
export interface BatchPoint { latitudeE7: number; longitudeE7: number }
export interface BatchStop extends BatchPoint { shipmentId: string }
export interface BatchRoute { shipmentIds: string[]; straightLineMetres: number }

function validPoint(p: BatchPoint): boolean {
  return Number.isSafeInteger(p.latitudeE7) && Math.abs(p.latitudeE7) <= 900_000_000 &&
    Number.isSafeInteger(p.longitudeE7) && Math.abs(p.longitudeE7) <= 1_800_000_000;
}

function distance(a: BatchPoint, b: BatchPoint): number {
  const rad = Math.PI / 180, latA = a.latitudeE7 / 10_000_000 * rad, latB = b.latitudeE7 / 10_000_000 * rad;
  const dLat = latB - latA, dLng = (b.longitudeE7 - a.longitudeE7) / 10_000_000 * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** Exhaustively choose the shortest straight-line order for at most three dropoffs.
 * Ties use shipment IDs for reproducibility; actual roads and ETA require a provider.
 */
export function planFoodBatchRoute(pickup: BatchPoint, stops: BatchStop[]): BatchRoute {
  if (!validPoint(pickup) || stops.length < 1 || stops.length > 3 ||
      stops.some(s => !s.shipmentId || !validPoint(s)) || new Set(stops.map(s => s.shipmentId)).size !== stops.length) {
    throw new Error('INVALID_BATCH_ROUTE');
  }
  let best: { ids: string[]; metres: number } | undefined;
  function visit(current: BatchPoint, remaining: BatchStop[], ids: string[], metres: number): void {
    if (!remaining.length) {
      const key = ids.join('\u0000');
      if (!best || metres < best.metres - 1e-7 || (Math.abs(metres - best.metres) <= 1e-7 && key < best.ids.join('\u0000'))) {
        best = { ids, metres };
      }
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      const stop = remaining[i];
      visit(stop, [...remaining.slice(0, i), ...remaining.slice(i + 1)], [...ids, stop.shipmentId], metres + distance(current, stop));
    }
  }
  visit(pickup, stops, [], 0);
  return { shipmentIds: best!.ids, straightLineMetres: Math.ceil(best!.metres) };
}
