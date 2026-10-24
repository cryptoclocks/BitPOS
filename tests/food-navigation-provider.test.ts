import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  readFoodNavigationConfig,
  fetchFoodRoute,
  type FoodNavigationConfig,
  type FoodRouteInput,
  type FoodRoutePoint,
} from '../apps/api/src/food-navigation-provider';

const input: FoodRouteInput = {
  origin: {latitudeE7: 0, longitudeE7: 0},
  destination: {latitudeE7: 0, longitudeE7: 10000},
  mode: 'motorcycle',
};
const providerConfig = (extra: NodeJS.ProcessEnv = {}): FoodNavigationConfig => readFoodNavigationConfig({
  BITPOS_FOOD_ROUTE_ORIGIN: 'https://routes.example.invalid',
  BITPOS_FOOD_ROUTE_ATTRIBUTION: 'Configured route attribution',
  ...extra,
});
const config = providerConfig();
const unavailable = (reason: 'unconfigured' | 'provider_unavailable' | 'invalid_response') =>
  ({kind: 'unavailable', reason});

function routeBody(shape = '???o}@') {
  return {trip: {
    status: 0,
    units: 'kilometers',
    summary: {time: 24.5, length: 0.125},
    legs: [{summary: {time: 24.5, length: 0.125}, shape}],
  }};
}
function jsonFetch(value: unknown, init?: ResponseInit): typeof fetch {
  return async () => new Response(JSON.stringify(value), init);
}
function encodePoints(points: readonly FoodRoutePoint[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let shape = '';
  const encode = (delta: number): void => {
    let value = delta < 0 ? -delta * 2 - 1 : delta * 2;
    while (value >= 32) {
      shape += String.fromCharCode(63 + value % 32 + 32);
      value = Math.floor(value / 32);
    }
    shape += String.fromCharCode(63 + value);
  };
  for (const point of points) {
    const latitude = point.latitudeE7 / 10;
    const longitude = point.longitudeE7 / 10;
    encode(latitude - previousLatitude);
    encode(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }
  return shape;
}

test('missing configuration disables navigation without contacting a provider', async () => {
  const missing = readFoodNavigationConfig({});
  assert.deepEqual(missing, unavailable('unconfigured'));
  assert.deepEqual(await fetchFoodRoute(missing, input, {
    fetch: async () => { throw new Error('must not be contacted'); },
  }), unavailable('unconfigured'));
});

test('partial and unsafe configuration throws only a sanitized configuration error', () => {
  const bad: NodeJS.ProcessEnv[] = [
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://secret.example.invalid'},
    {BITPOS_FOOD_ROUTE_ATTRIBUTION: 'Attribution'},
    {BITPOS_FOOD_ROUTE_ORIGIN: ''},
    {BITPOS_FOOD_ROUTE_ATTRIBUTION: ''},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://secret:password@example.invalid'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://@example.invalid'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://example.invalid/path'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://example.invalid/..'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://example.invalid/?secret'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://example.invalid/?'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://example.invalid/#secret'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'https://example.invalid/#'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'http://example.invalid', BITPOS_FOOD_NAVIGATION_FIXTURE: '1'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'http://127.0.0.1:8002'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'http://localhost:8002', BITPOS_FOOD_NAVIGATION_FIXTURE: 'true'},
    {BITPOS_FOOD_ROUTE_ORIGIN: 'file:///private/secret'},
    {BITPOS_FOOD_ROUTE_BEARER: 'secret\r\nInjected: value'},
    {BITPOS_FOOD_ROUTE_BEARER: ''},
    {BITPOS_FOOD_ROUTE_ATTRIBUTION: '   '},
    {BITPOS_FOOD_ROUTE_ATTRIBUTION: 'secret\nsecond line'},
  ];
  for (const env of bad) {
    const configured = Object.keys(env).length === 1 &&
      (env.BITPOS_FOOD_ROUTE_ORIGIN === 'https://secret.example.invalid' ||
       env.BITPOS_FOOD_ROUTE_ATTRIBUTION === 'Attribution')
      ? env : {
          BITPOS_FOOD_ROUTE_ORIGIN: 'https://routes.example.invalid',
          BITPOS_FOOD_ROUTE_ATTRIBUTION: 'Attribution', ...env,
        };
    assert.throws(() => readFoodNavigationConfig(configured), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Invalid food navigation configuration');
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('HTTP is permitted only for explicit loopback fixtures; provenance survives the route result', async () => {
  for (const host of ['127.0.0.1', '127.2.3.4', 'localhost', '[::1]']) {
    const fixture = providerConfig({
      BITPOS_FOOD_ROUTE_ORIGIN: `http://${host}:8002/`,
      BITPOS_FOOD_NAVIGATION_FIXTURE: '1',
    });
    const result = await fetchFoodRoute(fixture, input, {fetch: jsonFetch(routeBody())});
    assert.deepEqual(result, {
      kind: 'route', points: [input.origin, input.destination],
      durationSeconds: 25, distanceMetres: 125,
      fixture: true, attribution: 'Configured route attribution',
    });
  }
});

test('sends only coordinates and costing to Valhalla, with server-only bearer and no redirects', async () => {
  for (const mode of ['motorcycle', 'auto'] as const) {
    let calls = 0;
    const result = await fetchFoodRoute(providerConfig({BITPOS_FOOD_ROUTE_BEARER: 'server-secret'}), {
      ...input, mode,
    }, {fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://routes.example.invalid/route');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      assert.ok(init?.signal instanceof AbortSignal);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('authorization'), 'Bearer server-secret');
      assert.equal(headers.get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        locations: [{lat: 0, lon: 0}, {lat: 0, lon: 0.001}],
        costing: mode, shape_format: 'polyline6', directions_options: {units: 'kilometers'},
      });
      return new Response(JSON.stringify(routeBody()));
    }});
    assert.deepEqual(result, {
      kind: 'route', points: [input.origin, input.destination],
      durationSeconds: 25, distanceMetres: 125,
      fixture: false, attribution: 'Configured route attribution',
    });
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes('server-secret'));
    assert.ok(!JSON.stringify(result).includes('routes.example.invalid'));
  }
});

test('no bearer header is invented when a configured provider does not need one', async () => {
  const result = await fetchFoodRoute(config, input, {fetch: async (_url, init) => {
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return new Response(JSON.stringify(routeBody()));
  }});
  assert.equal(result.kind, 'route');
});

test('invalid integer coordinates and unsupported modes fail before any provider call', async () => {
  const invalid: unknown[] = [
    {...input, origin: {latitudeE7: 0.5, longitudeE7: 0}},
    {...input, origin: {latitudeE7: 900000001, longitudeE7: 0}},
    {...input, destination: {latitudeE7: 0, longitudeE7: -1800000001}},
    {...input, destination: {latitudeE7: Number.NaN, longitudeE7: 0}},
    {...input, destination: {latitudeE7: 0, longitudeE7: Number.POSITIVE_INFINITY}},
    {...input, origin: null}, {...input, mode: 'bicycle'}, null,
  ];
  let calls = 0;
  for (const value of invalid) {
    assert.deepEqual(await fetchFoodRoute(config, value as FoodRouteInput, {fetch: async () => {
      calls++;
      return new Response(JSON.stringify(routeBody()));
    }}), unavailable('invalid_response'));
  }
  assert.equal(calls, 0);
});

test('provider rejection, redirects, and network failures return sanitized unavailable without fallback', async () => {
  for (const status of [301, 401, 429, 500, 503]) {
    let calls = 0;
    const result = await fetchFoodRoute(config, input, {fetch: async () => {
      calls++;
      return new Response('private provider details', {
        status, headers: {location: 'https://secret.example.invalid/private'},
      });
    }});
    assert.deepEqual(result, unavailable('provider_unavailable'));
    assert.equal(calls, 1);
  }
  assert.deepEqual(await fetchFoodRoute(config, input, {fetch: async () => {
    throw new Error('https://secret.example.invalid private credential');
  }}), unavailable('provider_unavailable'));
  const rejected = routeBody();
  rejected.trip.status = 442;
  assert.deepEqual(await fetchFoodRoute(config, input, {fetch: jsonFetch(rejected)}),
    unavailable('provider_unavailable'));
});

test('rejects invalid units, status, leg count, summaries, and malformed JSON', async () => {
  const cases: unknown[] = [null, {}, {trip: null}];
  const mutate = (change: (body: ReturnType<typeof routeBody>) => void): void => {
    const body = routeBody(); change(body); cases.push(body);
  };
  mutate(body => { body.trip.units = 'miles'; });
  mutate(body => { delete (body.trip as Partial<typeof body.trip>).units; });
  mutate(body => { (body.trip as Record<string, unknown>).status = '0'; });
  mutate(body => { body.trip.legs = []; });
  mutate(body => { body.trip.legs.push({...body.trip.legs[0]}); });
  mutate(body => { body.trip.summary.time = -1; });
  mutate(body => { body.trip.summary.length = -1; });
  mutate(body => { (body.trip.summary as Record<string, unknown>).time = '24.5'; });
  mutate(body => { body.trip.summary.length = Number.MAX_VALUE; });
  mutate(body => { body.trip.legs[0].summary.time = 99; });
  mutate(body => { body.trip.legs[0].summary.length = 99; });
  mutate(body => { delete (body.trip.legs[0] as Partial<typeof body.trip.legs[0]>).summary; });
  for (const body of cases) {
    assert.deepEqual(await fetchFoodRoute(config, input, {fetch: jsonFetch(body)}),
      unavailable('invalid_response'));
  }
  for (const text of ['not json', '{"trip":', JSON.stringify(routeBody()).replace('24.5', '1e999')]) {
    assert.deepEqual(await fetchFoodRoute(config, input, {
      fetch: async () => new Response(text),
    }), unavailable('invalid_response'));
  }
  assert.deepEqual(await fetchFoodRoute(config, input, {
    fetch: async () => new Response(new Uint8Array([0xff, 0xfe])),
  }), unavailable('invalid_response'));
});

test('rejects malformed, overflowing, out-of-range and excessive polyline geometry', async () => {
  const tooMany = Array.from({length: 2049}, () => input.origin);
  const badShapes: unknown[] = [
    null, '', '??', '???', '???o}', '???\u0000', '???\u007f',
    '_????', '~~~~~~????', '???????~',
    encodePoints([{latitudeE7: 900000010, longitudeE7: 0}, input.destination]),
    encodePoints([input.origin, {latitudeE7: 0, longitudeE7: 1800000010}]),
    encodePoints(tooMany),
  ];
  for (const shape of badShapes) {
    const body = routeBody();
    (body.trip.legs[0] as Record<string, unknown>).shape = shape;
    assert.deepEqual(await fetchFoodRoute(config, input, {fetch: jsonFetch(body)}),
      unavailable('invalid_response'));
  }
});

test('accepts exactly 2048 bounded points and safe large signed deltas across the dateline', async () => {
  const points = [...Array.from({length: 2047}, () => input.origin), input.destination];
  const result = await fetchFoodRoute(config, input, {fetch: jsonFetch(routeBody(encodePoints(points)))});
  assert.equal(result.kind, 'route');
  if (result.kind !== 'route') assert.fail('expected bounded route');
  assert.deepEqual(result.points, points);
  const dateline: FoodRouteInput = {
    origin: {latitudeE7: -900000000, longitudeE7: -1800000000},
    destination: {latitudeE7: 900000000, longitudeE7: 1800000000}, mode: 'auto',
  };
  const edgePoints = [dateline.origin, dateline.destination];
  const edgeResult = await fetchFoodRoute(config, dateline, {
    fetch: jsonFetch(routeBody(encodePoints(edgePoints))),
  });
  assert.equal(edgeResult.kind, 'route');
  if (edgeResult.kind !== 'route') assert.fail('expected bounded world-coordinate route');
  assert.deepEqual(edgeResult.points, edgePoints);
});

test('allows road snapping within 500 metres but rejects either distant endpoint', async () => {
  const snapped = [
    {latitudeE7: 30000, longitudeE7: 0},
    {latitudeE7: 30000, longitudeE7: 10000},
  ];
  assert.equal((await fetchFoodRoute(config, input, {
    fetch: jsonFetch(routeBody(encodePoints(snapped))),
  })).kind, 'route');
  for (const points of [
    [{latitudeE7: 50000, longitudeE7: 0}, input.destination],
    [input.origin, {latitudeE7: 50000, longitudeE7: 10000}],
  ]) {
    assert.deepEqual(await fetchFoodRoute(config, input, {
      fetch: jsonFetch(routeBody(encodePoints(points))),
    }), unavailable('invalid_response'));
  }
});

test('enforces the decoded-body 64 KiB limit even with a missing or dishonest length header', async () => {
  const body = JSON.stringify(routeBody());
  const exactLimit = body + ' '.repeat(65536 - Buffer.byteLength(body));
  assert.equal((await fetchFoodRoute(config, input, {
    fetch: async () => new Response(exactLimit),
  })).kind, 'route');
  for (const declared of [undefined, '1']) {
    let cancelled = false;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(pulls === 1 ? 65536 : 1).fill(32));
      },
      cancel() { cancelled = true; },
    }, {highWaterMark: 0});
    assert.deepEqual(await fetchFoodRoute(config, input, {fetch: async () => new Response(stream, {
      headers: declared === undefined ? {} : {'content-length': declared},
    })}), unavailable('invalid_response'));
    assert.equal(cancelled, true);
  }
  let cancelled = false;
  assert.deepEqual(await fetchFoodRoute(config, input, {fetch: async () => new Response(
    new ReadableStream<Uint8Array>({cancel() { cancelled = true; }}),
    {headers: {'content-length': '65537'}},
  )}), unavailable('invalid_response'));
  assert.equal(cancelled, true);
});

test('a previously aborted caller does not contact the provider', async () => {
  const controller = new AbortController();
  controller.abort(new Error('private caller reason'));
  let calls = 0;
  const result = await fetchFoodRoute(config, input, {signal: controller.signal, fetch: async () => {
    calls++;
    return new Response(JSON.stringify(routeBody()));
  }});
  assert.deepEqual(result, unavailable('provider_unavailable'));
  assert.equal(calls, 0);
});

test('caller abort cancels a stalled body and returns no partial geometry', async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let cancelled = false;
  let providerSignal: AbortSignal | null | undefined;
  const stream = new ReadableStream<Uint8Array>({
    pull() { entered(); },
    cancel() { cancelled = true; },
  }, {highWaterMark: 0});
  const pending = fetchFoodRoute(config, input, {signal: controller.signal, fetch: async (_url, init) => {
    providerSignal = init?.signal;
    return new Response(stream);
  }});
  await reading;
  controller.abort(new Error('private caller reason'));
  assert.deepEqual(await pending, unavailable('provider_unavailable'));
  assert.equal(providerSignal?.aborted, true);
  assert.equal(cancelled, true);
});

test('five-second timeout returns even if a transport ignores cancellation', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let providerSignal: AbortSignal | null | undefined;
  const pending = fetchFoodRoute(config, input, {fetch: (_url, init) => {
    providerSignal = init?.signal;
    return new Promise<Response>(() => {});
  }});
  t.mock.timers.tick(4999);
  assert.equal(providerSignal?.aborted, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, unavailable('provider_unavailable'));
  assert.equal(providerSignal?.aborted, true);
});

test('timeout also bounds reading a response body, not just receiving headers', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let cancelled = false;
  const pending = fetchFoodRoute(config, input, {fetch: async () => new Response(
    new ReadableStream<Uint8Array>({
      pull() { entered(); }, cancel() { cancelled = true; },
    }, {highWaterMark: 0}),
  )});
  await reading;
  t.mock.timers.tick(5000);
  assert.deepEqual(await pending, unavailable('provider_unavailable'));
  assert.equal(cancelled, true);
});

test('a response arriving after caller cancellation has its body discarded', async () => {
  const controller = new AbortController();
  let resolveFetch!: (response: Response) => void;
  let resolveCancelled!: () => void;
  const cancelled = new Promise<void>(resolve => { resolveCancelled = resolve; });
  const pending = fetchFoodRoute(config, input, {
    signal: controller.signal,
    fetch: () => new Promise<Response>(resolve => { resolveFetch = resolve; }),
  });
  controller.abort();
  assert.deepEqual(await pending, unavailable('provider_unavailable'));
  resolveFetch(new Response(new ReadableStream<Uint8Array>({cancel() { resolveCancelled(); }})));
  await cancelled;
});
