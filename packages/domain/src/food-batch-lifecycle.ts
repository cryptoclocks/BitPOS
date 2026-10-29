/** Batch custody rules. Persistence, authorization and proof verification remain server responsibilities. */
export type BatchLegState = 'ACCEPTED' | 'AT_PICKUP' | 'PICKED_UP' | 'AT_DROPOFF' | 'DELIVERED' | 'RELEASED' | 'INCIDENT';
export interface BatchLeg { shipmentId: string; state: BatchLegState; pickedUp: boolean }
export interface FoodBatch { driverId: string; version: number; legs: BatchLeg[] }
export type BatchAction = 'ARRIVE_PICKUP' | 'CONFIRM_PICKUP' | 'ARRIVE_DROPOFF' | 'CONFIRM_DELIVERY' | 'RELEASE' | 'INCIDENT' | 'RESUME';

const terminal = (leg: BatchLeg) => leg.state === 'DELIVERED' || leg.state === 'RELEASED';
function valid(batch: FoodBatch): boolean {
 return Boolean(batch.driverId) && Number.isSafeInteger(batch.version) && batch.version >= 1 && batch.version < Number.MAX_SAFE_INTEGER && batch.legs.length >= 2 && batch.legs.length <= 3 &&
  batch.legs.every(leg => Boolean(leg.shipmentId) && ['ACCEPTED','AT_PICKUP','PICKED_UP','AT_DROPOFF','DELIVERED','RELEASED','INCIDENT'].includes(leg.state) && typeof leg.pickedUp === 'boolean' && (leg.state === 'INCIDENT' || leg.pickedUp === ['PICKED_UP','AT_DROPOFF','DELIVERED'].includes(leg.state))) &&
  new Set(batch.legs.map(leg => leg.shipmentId)).size === batch.legs.length;
}

/** Applies a verified per-shipment event with optimistic version checking. */
export function advanceFoodBatch(batch: FoodBatch, shipmentId: string, expectedVersion: number, action: BatchAction): FoodBatch {
 if (!valid(batch)) throw new Error('INVALID_BATCH');
 if (batch.version !== expectedVersion) throw new Error('VERSION_CONFLICT');
 const leg = batch.legs.find(value => value.shipmentId === shipmentId);
 if (!leg) throw new Error('RESOURCE_NOT_FOUND');
 let state: BatchLegState;
 switch (action) {
  case 'ARRIVE_PICKUP': if (leg.state !== 'ACCEPTED') throw new Error('TRANSITION_INVALID'); state = 'AT_PICKUP'; break;
  case 'CONFIRM_PICKUP': if (leg.state !== 'AT_PICKUP') throw new Error('TRANSITION_INVALID'); state = 'PICKED_UP'; break;
  case 'ARRIVE_DROPOFF': if (leg.state !== 'PICKED_UP') throw new Error('TRANSITION_INVALID'); state = 'AT_DROPOFF'; break;
  case 'CONFIRM_DELIVERY': if (leg.state !== 'AT_DROPOFF') throw new Error('TRANSITION_INVALID'); state = 'DELIVERED'; break;
  case 'RELEASE': if (leg.pickedUp) throw new Error('CUSTODY_RETAINED'); if (!['ACCEPTED','AT_PICKUP'].includes(leg.state)) throw new Error('TRANSITION_INVALID'); state = 'RELEASED'; break;
  case 'INCIDENT': if (terminal(leg) || leg.state === 'INCIDENT') throw new Error('TRANSITION_INVALID'); state = 'INCIDENT'; break;
  case 'RESUME': if (leg.state !== 'INCIDENT') throw new Error('TRANSITION_INVALID'); state = leg.pickedUp ? 'PICKED_UP' : 'ACCEPTED'; break;
 }
 return { ...batch, version: batch.version + 1, legs: batch.legs.map(value => value === leg ? { ...leg, state, pickedUp: leg.pickedUp || action === 'CONFIRM_PICKUP' } : value) };
}

/** Driver occupancy must remain held until every individual leg is terminal. */
export function foodBatchComplete(batch: FoodBatch): boolean {
 if (!valid(batch)) throw new Error('INVALID_BATCH');
 return batch.legs.every(terminal);
}
