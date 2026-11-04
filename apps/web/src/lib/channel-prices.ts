// M03b: pure helpers for the channel price editor. The server stores integer minor units; blank = "use the base price".
export type Channel = 'counter' | 'table' | 'online';
export const channelOrder: Channel[] = ['counter', 'table', 'online'];
export interface ChannelCell { productId: string; channel: Channel; unitMinor: string }
export const cellKey = (productId: string, channel: Channel) => `${productId}|${channel}`;
export function savedMap(prices: ChannelCell[]): Map<string, string> { return new Map(prices.map(p => [cellKey(p.productId, p.channel), p.unitMinor])); }
/** Only cells whose text differs from what is saved are sent. A parse failure returns the offending cell instead of guessing. */
export function channelChanges(saved: Map<string, string>, draft: Record<string, string>, parse: (text: string) => string): { set: { productId: string; channel: Channel; unitMinor: string | null }[] } | { bad: string } {
  const set: { productId: string; channel: Channel; unitMinor: string | null }[] = [];
  for (const [key, raw] of Object.entries(draft)) {
    const [productId, channel] = key.split('|') as [string, Channel], text = raw.trim(), was = saved.get(key) ?? null;
    if (!text) { if (was !== null) set.push({ productId, channel, unitMinor: null }); continue; }
    let minor: string;
    try { minor = parse(text); } catch { return { bad: key }; }
    if (minor !== was) set.push({ productId, channel, unitMinor: minor });
  }
  return { set };
}
