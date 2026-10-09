import type { CounterCreate, OrderAuthority, OrderView, PriceConfiguration, Quote } from '../../../../packages/contracts/src/index';
export interface Session { token: string; merchantId: string; userId: string; role: string }
export interface Table { id: string; label: string; retiredAt: string | null }
export interface Device { id: string; label: string; tableId: string | null; tableLabel: string | null; assignmentGeneration: string; authGeneration: string; revokedAt: string | null; online: boolean; lastSeenAt: string | null; connectionGeneration: string; screen: { kind: 'idle' | 'cart' | 'order'; screenGeneration: string; orderId: string | null; sessionId: string | null } }
export interface Register { id: string; label: string; deviceId: string | null; pairingGeneration: string; retiredAt: string | null; targetOnline: boolean }
export interface PricingView { revision: string; configured: boolean; priceVersion: string | null; catalogCurrency: 'USD' | 'USDG' | null; decimals: 2 | 6 | null; provenance: PriceConfiguration['provenance'] | null; prices: { productId: string; unitMinor: string }[]; settlement: Omit<PriceConfiguration['settlement'], 'quotePolicy'> & { genesisHash: string; quotePolicy: PriceConfiguration['settlement']['quotePolicy'] | null } }
export interface ReviewQuote extends Quote { authority: OrderAuthority; pairingGeneration: string; targetOnline: boolean; targetBusy: boolean }
export type PrivateOrder = OrderView & { customerId?: string; accessToken?: string; createdAt?: string };
export type ServingSelection = CounterCreate['serving'];
export type CounterRequest = CounterCreate;
