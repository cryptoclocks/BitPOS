// Passenger trip core: integer-minor fare quote, trip state machine with arrival PIN,
// shared-seat occupancy and safety-share tokens. Pure functions: no I/O, no payment,
// no map provider. Routes, SQL and settlement are separate, unadmitted work.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export interface FareRates { currency: string; decimals: number; baseMinor: bigint; perKmMinor: bigint; perMinuteMinor: bigint; minimumMinor: bigint; sharedDiscountBps: number }
export interface QuoteInput { distanceMetres: number; durationSeconds: number; seats: number; shared: boolean }
export interface FareQuote { currency: string; decimals: number; totalMinor: bigint; seats: number; shared: boolean }
const intIn = (v: number, lo: number, hi: number) => Number.isSafeInteger(v) && v >= lo && v <= hi;

/** Fare in integer minor units. Per-seat shared trips get a basis-point discount; rounding is down per seat. */
export function quoteFare(rates: FareRates, input: QuoteInput): FareQuote {
  if (!intIn(input.distanceMetres, 1, 500_000) || !intIn(input.durationSeconds, 1, 86_400) || !intIn(input.seats, 1, 6)) throw new Error('INVALID_TRIP: distance, duration or seats out of range');
  if (!intIn(rates.sharedDiscountBps, 0, 9_000)) throw new Error('INVALID_TRIP: discount out of range');
  const km = (BigInt(input.distanceMetres) * rates.perKmMinor) / 1000n;
  const minutes = (BigInt(input.durationSeconds) * rates.perMinuteMinor) / 60n;
  let perSeat = rates.baseMinor + km + minutes;
  if (perSeat < rates.minimumMinor) perSeat = rates.minimumMinor;
  if (input.shared) perSeat = (perSeat * BigInt(10_000 - rates.sharedDiscountBps)) / 10_000n;
  if (input.shared && perSeat < 1n) perSeat = 1n;
  return { currency: rates.currency, decimals: rates.decimals, totalMinor: perSeat * BigInt(input.seats), seats: input.seats, shared: input.shared };
}

export type TripState = 'REQUESTED' | 'MATCHED' | 'ARRIVED' | 'IN_TRIP' | 'COMPLETED' | 'CANCELLED';
const next: Record<TripState, TripState[]> = { REQUESTED: ['MATCHED', 'CANCELLED'], MATCHED: ['ARRIVED', 'CANCELLED'], ARRIVED: ['IN_TRIP', 'CANCELLED'], IN_TRIP: ['COMPLETED'], COMPLETED: [], CANCELLED: [] };
export const canTransition = (from: TripState, to: TripState) => next[from].includes(to);
export const terminal = (s: TripState) => next[s].length === 0;

export const pinAttemptLimit = 3;
export interface TripPin { hash: string; salt: string; attempts: number }
const pinHash = (pin: string, salt: string) => createHash('sha256').update(`${salt}:${pin}`).digest('hex');
/** Issue a 4-digit arrival PIN. Only the salted hash is kept; the plain PIN is shown to the passenger once. */
export function issuePin(): { pin: string; record: TripPin } {
  const pin = String(randomInt(0, 10_000)).padStart(4, '0');
  const salt = randomBytes(8).toString('hex');
  return { pin, record: { hash: pinHash(pin, salt), salt, attempts: 0 } };
}
/** Constant-time check. A wrong attempt is counted; at the limit the PIN is locked even for the right value. */
export function checkPin(record: TripPin, candidate: string): { ok: boolean; record: TripPin; locked: boolean } {
  if (record.attempts >= pinAttemptLimit) return { ok: false, record, locked: true };
  const a = Buffer.from(pinHash(/^\d{4}$/.test(candidate) ? candidate : 'x', record.salt)), b = Buffer.from(record.hash);
  const ok = /^\d{4}$/.test(candidate) && timingSafeEqual(a, b);
  if (ok) return { ok: true, record, locked: false };
  const attempts = record.attempts + 1;
  return { ok: false, record: { ...record, attempts }, locked: attempts >= pinAttemptLimit };
}

export const vehicleSeatsMax = 6;
/** Shared occupancy: seats already booked plus requested must fit; exclusive trips need an empty vehicle. */
export function canJoin(capacity: number, booked: number[], seats: number, shared: boolean, existingShared: boolean): boolean {
  if (!intIn(capacity, 1, vehicleSeatsMax) || !intIn(seats, 1, vehicleSeatsMax) || booked.some(s => !intIn(s, 1, vehicleSeatsMax))) return false;
  const used = booked.reduce((a, b) => a + b, 0);
  if (used === 0) return seats <= capacity;
  return shared && existingShared && used + seats <= capacity;
}

export const safetyShareTtlSeconds = 6 * 3600;
/** Safety-share token: random, returned once, stored as a hash, expires; revocable by the passenger. */
export function issueShareToken(now: number): { token: string; hash: string; expiresAt: number } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex'), expiresAt: now + safetyShareTtlSeconds * 1000 };
}
export function shareValid(stored: { hash: string; expiresAt: number; revoked?: boolean }, presented: string, now: number): boolean {
  if (stored.revoked || now >= stored.expiresAt) return false;
  const a = Buffer.from(createHash('sha256').update(presented).digest('hex')), b = Buffer.from(stored.hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
