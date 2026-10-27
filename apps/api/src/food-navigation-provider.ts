import {z} from 'zod';
export interface FoodRoutePoint {
  readonly latitudeE7: number;
  readonly longitudeE7: number;
}

export interface FoodRouteInput {
  readonly origin: FoodRoutePoint;
  readonly destination: FoodRoutePoint;
  readonly mode: 'motorcycle' | 'auto';
}

export type FoodNavigationConfig =
  | {kind: 'unavailable'; reason: 'unconfigured'}
  | {kind: 'valhalla'; origin: URL; bearer?: string; fixture: boolean; attribution: string};

export type FoodRouteResult =
  | {kind: 'unavailable'; reason: 'unconfigured' | 'provider_unavailable' | 'invalid_response'}
  | {
      kind: 'route';
      points: readonly FoodRoutePoint[];
      durationSeconds: number;
      distanceMetres: number;
      fixture: boolean;
      attribution: string;
    };

export interface FoodRouteOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_POINTS = 2048;
const TIMEOUT_MS = 5000;
const ENDPOINT_TOLERANCE_METRES = 500;

/** Server-only configuration. Neither credentials nor origin belong in mobile responses. */
export function readFoodNavigationConfig(env: NodeJS.ProcessEnv): FoodNavigationConfig {
  const rawOrigin = env.BITPOS_FOOD_ROUTE_ORIGIN;
  const rawAttribution = env.BITPOS_FOOD_ROUTE_ATTRIBUTION;
  if (rawOrigin === undefined && rawAttribution === undefined && env.BITPOS_FOOD_ROUTE_BEARER === undefined) {
    return {kind: 'unavailable', reason: 'unconfigured'};
  }
  try {
    // Inspect the original authority too: URL normalizes empty userinfo and dot paths.
    if (rawOrigin === undefined || rawAttribution === undefined ||
        !/^https?:\/\/[^\s/?#@]+\/?$/i.test(rawOrigin)) {
      throw new Error();
    }
    const origin = new URL(rawOrigin);
    const fixture = env.BITPOS_FOOD_NAVIGATION_FIXTURE === '1';
    const loopback = origin.hostname === 'localhost' || origin.hostname === '[::1]' ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(origin.hostname);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
        (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && fixture && loopback))) {
      throw new Error();
    }
    const attribution = rawAttribution.trim();
    if (!attribution || attribution.length > 512 || /[\u0000-\u001f\u007f]/.test(rawAttribution)) {
      throw new Error();
    }
    const bearer = env.BITPOS_FOOD_ROUTE_BEARER;
    if (bearer !== undefined &&
        (bearer.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/.test(bearer))) {
      throw new Error();
    }
    return {kind: 'valhalla', origin, fixture, attribution, ...(bearer === undefined ? {} : {bearer})};
  } catch {
    // Do not attach a cause: malformed URLs and tokens can contain secrets.
    throw new Error('Invalid food navigation configuration');
  }
}

class InvalidResponse extends Error {}
class ProviderUnavailable extends Error {}

const PointSchema=z.object({latitudeE7:z.number().int().min(-900000000).max(900000000),longitudeE7:z.number().int().min(-1800000000).max(1800000000)}).strict();
const InputSchema=z.object({origin:PointSchema,destination:PointSchema,mode:z.enum(['motorcycle','auto'])}).strict();
const SummarySchema=z.object({time:z.number().finite().nonnegative(),length:z.number().finite().nonnegative().refine(value=>Number.isFinite(value*1000))});
const StatusSchema=z.object({trip:z.object({status:z.number().int()})});
const RouteSchema=z.object({trip:z.object({status:z.literal(0),units:z.literal('kilometers'),summary:SummarySchema,
 legs:z.array(z.object({summary:SummarySchema,shape:z.string().min(1).max(MAX_POINTS*12)})).length(1)})});

/** Decode canonical polyline6 without signed 32-bit bitwise overflow. */
function decodeShape(shape: unknown): FoodRoutePoint[] {
  if (typeof shape !== 'string' || shape.length === 0 || shape.length > MAX_POINTS * 12) {
    throw new InvalidResponse();
  }
  let cursor = 0;
  let latitude = 0;
  let longitude = 0;
  const points: FoodRoutePoint[] = [];
  const delta = (): number => {
    let unsigned = 0;
    let place = 1;
    for (let group = 0; group < 6; group++) {
      if (cursor >= shape.length) throw new InvalidResponse();
      const byte = shape.charCodeAt(cursor++) - 63;
      if (byte < 0 || byte > 63) throw new InvalidResponse();
      const payload = byte % 32;
      unsigned += payload * place;
      if (!Number.isSafeInteger(unsigned)) throw new InvalidResponse();
      if (byte < 32) {
        if (group > 0 && payload === 0) throw new InvalidResponse();
        return unsigned % 2 === 0 ? unsigned / 2 : -(unsigned + 1) / 2;
      }
      place *= 32;
    }
    throw new InvalidResponse();
  };
  while (cursor < shape.length) {
    if (points.length === MAX_POINTS) throw new InvalidResponse();
    latitude += delta();
    longitude += delta();
    if (!Number.isSafeInteger(latitude) || !Number.isSafeInteger(longitude) ||
        Math.abs(latitude) > 90000000 || Math.abs(longitude) > 180000000) {
      throw new InvalidResponse();
    }
    points.push({latitudeE7: latitude * 10, longitudeE7: longitude * 10});
  }
  if (points.length < 2) throw new InvalidResponse();
  return points;
}

function endpointDistance(a: FoodRoutePoint, b: FoodRoutePoint): number {
  const radians = Math.PI / 180 / 10000000;
  const latitudeDelta = (b.latitudeE7 - a.latitudeE7) * radians;
  const longitudeDelta = (b.longitudeE7 - a.longitudeE7) * radians;
  const h = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a.latitudeE7 * radians) * Math.cos(b.latitudeE7 * radians) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function parseRoute(
  value: unknown,
  input: FoodRouteInput,
  config: Extract<FoodNavigationConfig, {kind: 'valhalla'}>,
): FoodRouteResult {
  const status=StatusSchema.safeParse(value);if(!status.success)throw new InvalidResponse();
  if(status.data.trip.status!==0)throw new ProviderUnavailable();
  const parsed=RouteSchema.safeParse(value);if(!parsed.success)throw new InvalidResponse();
  const trip=parsed.data.trip,leg=trip.legs[0],total=trip.summary,segment=leg.summary;
  // A single leg must agree with the trip: at most 1 ms / 1 metre rounding difference.
  if (Math.abs(total.time - segment.time) > 0.001 || Math.abs(total.length - segment.length) > 0.001) {
    throw new InvalidResponse();
  }
  const points = decodeShape(leg.shape);
  // Allow provider road-snapping, but never accept a route >500 m from either input endpoint.
  if (endpointDistance(points[0], input.origin) > ENDPOINT_TOLERANCE_METRES ||
      endpointDistance(points[points.length - 1], input.destination) > ENDPOINT_TOLERANCE_METRES) {
    throw new InvalidResponse();
  }
  const durationSeconds=Math.ceil(total.time),distanceMetres=Math.round(total.length*1000);
  if(!Number.isSafeInteger(durationSeconds)||!Number.isSafeInteger(distanceMetres))throw new InvalidResponse();
  return {
    kind: 'route', points, durationSeconds, distanceMetres,
    fixture: config.fixture, attribution: config.attribution,
  };
}

/**
 * One bounded server-only Valhalla request; no retries, redirect following or synthetic fallback.
 * Invalid caller coordinates fail closed as invalid_response without making a provider request.
 */
export async function fetchFoodRoute(
  config: FoodNavigationConfig,
  input: FoodRouteInput,
  options: FoodRouteOptions = {},
): Promise<FoodRouteResult> {
  if (config.kind === 'unavailable') return {kind: 'unavailable', reason: 'unconfigured'};
  if (!InputSchema.safeParse(input).success) return {kind: 'unavailable', reason: 'invalid_response'};
  if (options.signal?.aborted) return {kind: 'unavailable', reason: 'provider_unavailable'};

  const controller = new AbortController();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const discardBody = (): void => {
    try {
      const cancellation = reader ? reader.cancel() : response?.body?.cancel();
      void cancellation?.catch(() => {});
    } catch {
      // Cancellation must not expose transport errors or hold up the bounded result.
    }
  };
  let rejectAbort!: (reason: ProviderUnavailable) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = (): void => {
    discardBody();
    rejectAbort(new ProviderUnavailable());
  };
  const onCallerAbort = (): void => { controller.abort(); };
  controller.signal.addEventListener('abort', onAbort, {once: true});
  options.signal?.addEventListener('abort', onCallerAbort, {once: true});
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const perform = async (): Promise<FoodRouteResult> => {
    response = await (options.fetch ?? globalThis.fetch)(new URL('/route', config.origin), {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(config.bearer === undefined ? {} : {Authorization: `Bearer ${config.bearer}`}),
      },
      body: JSON.stringify({
        locations: [input.origin, input.destination].map(point => ({
          lat: point.latitudeE7 / 10000000,
          lon: point.longitudeE7 / 10000000,
        })),
        costing: input.mode,
        shape_format: 'polyline6',
        directions_options: {units: 'kilometers'},
      }),
    });
    // A supplied transport may resolve after cancellation instead of honoring its signal.
    if (controller.signal.aborted) {
      discardBody();
      throw new ProviderUnavailable();
    }
    if (!response.ok) throw new ProviderUnavailable();
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
      throw new InvalidResponse();
    }
    if (!response.body) throw new InvalidResponse();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BODY_BYTES) throw new InvalidResponse();
        chunks.push(chunk.value);
      }
    } finally {
      // Keep a failed stream available for the outer cancellation path.
      if (!controller.signal.aborted && size <= MAX_BODY_BYTES) {
        reader.releaseLock();
        reader = undefined;
      }
    }
    if (controller.signal.aborted) throw new ProviderUnavailable();
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, size)));
    } catch {
      throw new InvalidResponse();
    }
    return parseRoute(decoded, input, config);
  };

  try {
    return await Promise.race([perform(), aborted]);
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: controller.signal.aborted || !(error instanceof InvalidResponse)
        ? 'provider_unavailable' : 'invalid_response',
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onCallerAbort);
    controller.signal.removeEventListener('abort', onAbort);
    discardBody();
  }
}
