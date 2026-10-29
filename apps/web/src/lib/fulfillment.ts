import type { FulfillmentStatus } from '../../../../packages/contracts/src/index';
import type { PrivateOrder } from './table';
import type {FoodMerchantAcceptanceCommand} from '../../../../packages/contracts/src/mobile-v1.generated';

export const nextFulfillment: Record<FulfillmentStatus, FulfillmentStatus | null> = {
  RECEIVED: 'PREPARING', PREPARING: 'READY', READY: 'COLLECTED', COLLECTED: null,
};
export type FulfillmentAction =
  | { orderId: string; kind: 'fulfillment'; body: { status: FulfillmentStatus; expectedVersion: number; idempotencyKey: string } }
  | { orderId: string; kind: 'acceptance'; body: FoodMerchantAcceptanceCommand }
  | { orderId: string; kind: 'notification/retry'; body: { expectedVersion: number; idempotencyKey: string; targetDeviceId: string; assignmentGeneration: string; confirmTarget: true } };

// Fulfillment and notice updates do not advance the financial order version.
export function latestOrder(current: PrivateOrder | undefined, next: PrivateOrder): PrivateOrder {
  if (current && (current.version > next.version || (current.fulfillment?.version ?? -1) > (next.fulfillment?.version ?? -1) || (current.onlineAcceptance?.version ?? -1) > (next.onlineAcceptance?.version ?? -1) || BigInt(current.onlineAcceptance?.eventSequence??'0')>BigInt(next.onlineAcceptance?.eventSequence??'0'))) return current;
  return current?.id===next.id&&current.configuredFood&&!next.configuredFood?{...next,configuredFood:current.configuredFood}:next;
}
