// Group cart, multi-merchant parent checkout split and delivery batching rules.
// Pure functions over integer minor units. A parent order is never one payment: it is
// one child order per (merchant, currency); totals are never summed across denominations.
export interface CartLine { merchantId: string; productId: string; memberId: string; qty: number; unitMinor: bigint; currency: string; decimals: number }
export interface Money { currency: string; decimals: number; minor: bigint }
const intIn = (v: number, lo: number, hi: number) => Number.isSafeInteger(v) && v >= lo && v <= hi;

export const maxGroupMembers = 12;
export const maxLinesPerCart = 100;
export type GroupState = 'OPEN' | 'LOCKED' | 'SUBMITTED' | 'CANCELLED';
export interface GroupCart { id: string; ownerId: string; members: string[]; state: GroupState; lines: CartLine[]; version: number }

export function newGroup(id: string, ownerId: string): GroupCart { return { id, ownerId, members: [ownerId], state: 'OPEN', lines: [], version: 0 }; }
function open(g: GroupCart) { if (g.state !== 'OPEN') throw new Error('GROUP_NOT_OPEN'); }
export function join(g: GroupCart, memberId: string): GroupCart {
  open(g); if (g.members.includes(memberId)) return g;
  if (g.members.length >= maxGroupMembers) throw new Error('GROUP_FULL');
  return { ...g, members: [...g.members, memberId], version: g.version + 1 };
}
/** A member may only change their own lines; the owner may remove anyone's line but not add for them. */
export function setLine(g: GroupCart, actor: string, line: CartLine): GroupCart {
  open(g);
  if (!g.members.includes(actor) || line.memberId !== actor) throw new Error('NOT_YOUR_LINE');
  if (!intIn(line.qty, 0, 99) || line.unitMinor < 0n) throw new Error('INVALID_LINE');
  const rest = g.lines.filter(l => !(l.memberId === line.memberId && l.productId === line.productId && l.merchantId === line.merchantId));
  const lines = line.qty === 0 ? rest : [...rest, line];
  if (lines.length > maxLinesPerCart) throw new Error('CART_TOO_LARGE');
  return { ...g, lines, version: g.version + 1 };
}
export function removeLine(g: GroupCart, actor: string, memberId: string, merchantId: string, productId: string): GroupCart {
  open(g); if (actor !== memberId && actor !== g.ownerId) throw new Error('NOT_YOUR_LINE');
  return { ...g, lines: g.lines.filter(l => !(l.memberId === memberId && l.productId === productId && l.merchantId === merchantId)), version: g.version + 1 };
}
/** Only the owner locks; locking needs at least one line and freezes edits until submit/cancel. */
export function lock(g: GroupCart, actor: string): GroupCart {
  open(g); if (actor !== g.ownerId) throw new Error('OWNER_ONLY'); if (!g.lines.length) throw new Error('EMPTY_CART');
  return { ...g, state: 'LOCKED', version: g.version + 1 };
}

const key = (m: string, c: string, d: number) => `${m}|${c}|${d}`;
export interface ChildOrder { merchantId: string; money: Money; lines: CartLine[]; perMember: Record<string, bigint> }
/** One child order per merchant and currency. Mixed denominations within a merchant are separate children. */
export function splitParent(lines: CartLine[]): ChildOrder[] {
  const out = new Map<string, ChildOrder>();
  for (const l of lines) {
    const k = key(l.merchantId, l.currency, l.decimals);
    const c = out.get(k) ?? { merchantId: l.merchantId, money: { currency: l.currency, decimals: l.decimals, minor: 0n }, lines: [], perMember: {} };
    const amount = l.unitMinor * BigInt(l.qty);
    c.money.minor += amount; c.lines.push(l); c.perMember[l.memberId] = (c.perMember[l.memberId] ?? 0n) + amount;
    out.set(k, c);
  }
  return [...out.values()].sort((a, b) => a.merchantId.localeCompare(b.merchantId) || a.money.currency.localeCompare(b.money.currency));
}
/** Totals per currency only. */
export function totalsByCurrency(children: ChildOrder[]): Money[] {
  const t = new Map<string, Money>();
  for (const c of children) { const k = `${c.money.currency}|${c.money.decimals}`; const m = t.get(k) ?? { ...c.money, minor: 0n }; m.minor += c.money.minor; t.set(k, m); }
  return [...t.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
/** Shared fee split: largest remainder, deterministic by member id, sum is exact. */
export function splitFee(feeMinor: bigint, weights: Record<string, bigint>): Record<string, bigint> {
  const ids = Object.keys(weights).sort(); const total = ids.reduce((s, i) => s + weights[i], 0n);
  if (feeMinor < 0n || !ids.length || total <= 0n) throw new Error('INVALID_SPLIT');
  const base = ids.map(i => ({ i, q: (feeMinor * weights[i]) / total, r: (feeMinor * weights[i]) % total }));
  let left = feeMinor - base.reduce((s, b) => s + b.q, 0n);
  for (const b of [...base].sort((a, c) => (c.r > a.r ? 1 : c.r < a.r ? -1 : a.i.localeCompare(c.i)))) { if (left <= 0n) break; b.q += 1n; left -= 1n; }
  return Object.fromEntries(base.map(b => [b.i, b.q]));
}

export interface BatchCandidate { orderId: string; merchantId: string; readyAtMs: number; dropLat: number; dropLng: number; currency: string }
export const batchMaxOrders = 3, batchMaxReadyGapMs = 5 * 60_000, batchMaxDropKm = 2;
const km = (a: BatchCandidate, b: BatchCandidate) => { const r = Math.PI / 180, dLa = (b.dropLat - a.dropLat) * r, dLo = (b.dropLng - a.dropLng) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.dropLat * r) * Math.cos(b.dropLat * r) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))); };
const validCandidate = (c: BatchCandidate) => Boolean(c.orderId && c.merchantId && c.currency) && Number.isSafeInteger(c.readyAtMs) && Number.isFinite(c.dropLat) && Math.abs(c.dropLat) <= 90 && Number.isFinite(c.dropLng) && Math.abs(c.dropLng) <= 180;
/** Every pair must meet the limits. Invalid and duplicate records never enter a proposal. */
export function canBatch(anchor: BatchCandidate, others: BatchCandidate[]): BatchCandidate[] {
  if (!validCandidate(anchor)) return [];
  const picked: BatchCandidate[] = [];
  const seen = new Set([anchor.orderId]);
  for (const o of [...others].sort((a, b) => a.readyAtMs - b.readyAtMs || a.orderId.localeCompare(b.orderId))) {
    if (picked.length + 1 >= batchMaxOrders) break;
    if (!validCandidate(o) || seen.has(o.orderId) || o.merchantId !== anchor.merchantId || o.currency !== anchor.currency) continue;
    if ([anchor, ...picked].some(p => Math.abs(o.readyAtMs - p.readyAtMs) > batchMaxReadyGapMs || km(p, o) > batchMaxDropKm)) continue;
    seen.add(o.orderId);
    picked.push(o);
  }
  return picked;
}
