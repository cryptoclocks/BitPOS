import {localApiOrigin} from '../../lib/api-origin';
import type { APIRoute } from 'astro';
export const prerender = false;
const routes: [RegExp, readonly string[]][] = [
  [/^mobile\/v1\/platform\/merchants\/[0-9a-f-]{36}\/reviews$/, ['GET']],
  [/^mobile\/v1\/platform\/reviews\/[0-9a-f-]{36}$/, ['POST']],
  [/^mobile\/v1\/platform\/support$/, ['GET']],
  [/^mobile\/v1\/platform\/support\/[0-9a-f-]{36}$/, ['GET','POST']],
  [/^mobile\/v1\/auth\/(otp|verify|refresh|logout)$/, ['POST']],
  [/^mobile\/v1\/platform\/(roles|drivers)$/, ['GET']],
  [/^mobile\/v1\/platform\/drivers\/[0-9a-f-]{36}$/, ['GET']],
  [/^mobile\/v1\/platform\/drivers\/[0-9a-f-]{36}\/decision$/, ['POST']],
  [/^mobile\/v1\/platform\/merchants\/[0-9a-f-]{36}\/food\/incidents$/, ['GET']],
  [/^mobile\/v1\/platform\/food\/incidents\/[0-9a-f-]{36}\/review$/, ['GET']],
  [/^mobile\/v1\/platform\/food\/incidents\/[0-9a-f-]{36}\/(acknowledge|inspect)$/, ['POST']],
  [/^mobile\/v1\/platform\/food\/assignments\/[0-9a-f-]{36}\/resume$/, ['POST']],
  [/^mobile\/v1\/platform\/food\/assignments\/[0-9a-f-]{36}\/return$/, ['GET','POST']],
  [/^mobile\/v1\/driver\/food\/assignments\/[0-9a-f-]{36}\/compensation$/, ['GET']],
  [/^mobile\/v1\/platform\/food\/returns\/[0-9a-f-]{36}\/resolve$/, ['POST']],
  [/^mobile\/v1\/platform\/food\/returns\/[0-9a-f-]{36}\/financial-review$/, ['GET','POST']],
  [/^mobile\/v1\/platform\/food\/returns\/[0-9a-f-]{36}\/execution$/, ['GET']],
  [/^mobile\/v1\/platform\/food\/returns\/[0-9a-f-]{36}\/compensation$/, ['GET','POST']],
  [/^mobile\/v1\/platform\/food\/returns\/[0-9a-f-]{36}\/compensation-policy$/, ['POST']],
  [/^mobile\/v1\/platform\/food\/returns\/[0-9a-f-]{36}\/compensation-policy-retire$/, ['POST']],
  [/^mobile\/v1\/platform\/food\/returns\/[0-9a-f-]{36}\/compensation-execution$/, ['GET']],
  [/^mobile\/v1\/platform\/food\/returns\/[0-9a-f-]{36}\/reconcile-payments$/, ['POST']],
  [/^mobile\/v1\/platform\/merchants\/[0-9a-f-]{36}\/food\/cancellation-reviews$/, ['GET']],
  [/^mobile\/v1\/platform\/food\/cancellation-reviews\/[0-9a-f-]{36}\/review$/, ['GET']],
  [/^mobile\/v1\/platform\/food\/cancellation-reviews\/[0-9a-f-]{36}\/(inspect|disposition)$/, ['POST']],
  [/^mobile\/v1\/platform\/merchants\/[0-9a-f-]{36}\/branches\/[0-9a-f-]{36}\/food-dispatch$/, ['GET']],
  [/^mobile\/v1\/platform\/merchants\/[0-9a-f-]{36}\/branches\/[0-9a-f-]{36}\/food-dispatch-policy$/, ['GET','PUT']],
  [/^mobile\/v1\/platform\/food\/shipments\/[0-9a-f-]{36}\/search$/, ['GET','PUT']],
  [/^mobile\/v1\/platform\/food\/shipments\/[0-9a-f-]{36}\/offers$/, ['POST']],
  [/^mobile\/v1\/platform\/food\/assignments\/[0-9a-f-]{36}\/(withdraw|reoffer)$/, ['POST']],
  [/^mobile\/v1\/platform\/merchants\/[0-9a-f-]{36}\/earnings$/, ['GET']],
  [/^mobile\/v1\/platform\/earnings\/[0-9a-f-]{36}\/eligibility$/, ['POST']],
  [/^mobile\/v1\/platform\/settlement-batches$/, ['POST']],
  [/^mobile\/v1\/platform\/settlement-batches\/[0-9a-f-]{36}\/commands$/, ['POST']],
  [/^session$/, ['GET', 'POST', 'DELETE']],
  [/^demo-session$/, ['GET', 'POST']],
  [/^table\/[A-Za-z0-9_-]{43}$/, ['GET']],
  [/^table\/[A-Za-z0-9_-]{43}\/visit$/, ['POST']],
  [/^table\/[A-Za-z0-9_-]{43}\/visit\/[A-Za-z0-9_-]{43}$/, ['GET']],
  [/^table\/[A-Za-z0-9_-]{43}\/visit\/[A-Za-z0-9_-]{43}\/(quotes|orders|release|dismiss|repeat-quotes|copilot|transcribe)$/, ['POST']],
  [/^table\/[A-Za-z0-9_-]{43}\/visit\/[A-Za-z0-9_-]{43}\/copilot\/[0-9a-f-]{36}$/, ['GET']],
  [/^table\/[A-Za-z0-9_-]{43}\/visit\/[A-Za-z0-9_-]{43}\/grants\/(challenge|session|prepare|authorize|pause|revoke|reconcile|history|checkout)$/, ['POST']],
  [/^menu$/, ['GET']], [/^settings$/, ['GET', 'PUT']],
  [/^settings\/pricing$/, ['GET', 'PUT']],
  [/^settings\/payment-assets$/, ['GET', 'PUT']],
  [/^settings\/collection$/, ['GET', 'PUT']],
  [/^(tables|devices|registers)$/, ['GET', 'POST']],
  [/^(tables|devices)\/[A-Za-z0-9_-]+$/, ['PATCH']],
  [/^tables\/[A-Za-z0-9_-]+\/clear$/, ['POST']],
  [/^devices\/[A-Za-z0-9_-]+\/credential$/, ['POST', 'DELETE']],
  [/^registers\/[A-Za-z0-9_-]+\/pairing$/, ['PUT']],
  [/^registers\/[A-Za-z0-9_-]+\/(quotes|orders)$/, ['POST']],
  [/^registers\/[A-Za-z0-9_-]+\/orders\/[A-Za-z0-9_-]+\/dismiss$/, ['POST']],
  [/^registers\/[A-Za-z0-9_-]+\/submissions\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^products\/[A-Za-z0-9_-]+\/offer$/, ['GET', 'PUT', 'PATCH']],
  [/^products\/[0-9a-f-]{36}\/online-options$/, ['GET', 'PUT']],
  [/^customers$/, ['GET', 'POST']], [/^customers\/[A-Za-z0-9_-]+$/, ['PATCH']],
  [/^customers\/[A-Za-z0-9_-]+\/history$/, ['GET']],
  [/^orders$/, ['GET']], [/^orders\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^orders\/[A-Za-z0-9_-]+\/(recovery|cancel)$/, ['POST']],
  [/^orders\/[A-Za-z0-9_-]+\/(acceptance|fulfillment|notification\/retry)$/, ['POST']],
  [/^food\/orders\/[0-9a-f-]{36}\/refund-execution$/, ['GET']],
  [/^food\/assignments\/[0-9a-f-]{36}\/return$/, ['GET']],
  [/^food\/returns\/[0-9a-f-]{36}\/receive$/, ['POST']],
  [/^orders\/[0-9a-f-]{36}\/delivery$/, ['GET']],
  [/^orders\/[0-9a-f-]{36}\/delivery\/pickup-proof$/, ['POST']],
  [/^promotions$/, ['GET']],
  [/^promotions\/generate$/, ['POST']],
  [/^promotions\/recipients$/, ['GET']],
  [/^promotions\/recipients\/seat$/, ['POST']],
  [/^promotions\/devices\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^promotions\/jobs\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^promotions\/media\/[A-Za-z0-9_-]{43}\/(image\.rgb565|preview\.png)$/, ['GET']],
  [/^promotions\/[A-Za-z0-9_-]+$/, ['GET', 'PATCH']],
  [/^promotions\/[A-Za-z0-9_-]+\/(preview|approve|publish|revoke|derive)$/, ['POST']],
  [/^pay\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^pay\/[A-Za-z0-9_-]+\/events$/, ['GET']],
  [/^pay\/[A-Za-z0-9_-]+\/assets$/, ['GET']],
  [/^pay\/[A-Za-z0-9_-]+\/menu$/, ['GET']],
  [/^pay\/[A-Za-z0-9_-]+\/asset$/, ['POST']],
  [/^pay\/[A-Za-z0-9_-]+\/(challenge|bind|attempt|submit|dismiss)$/, ['POST']],
  [/^pay\/[A-Za-z0-9_-]+\/customer\/(challenge|verify|session|use|revoke)$/, ['POST']],
  [/^pay\/[A-Za-z0-9_-]+\/x402$/, ['POST']],
  [/^x402\/supported$/, ['GET']],
];
export const ALL: APIRoute = async ({ request, params }) => {
  const path = params.path || '';
  const route = routes.find(([pattern]) => pattern.test(path));
  if (!route) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!route[1].includes(request.method)) return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const headers = new Headers();
  for (const name of ['authorization', 'content-type']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  if (/^pay\/[A-Za-z0-9_-]+\/x402$/.test(path)) {
    const signature=request.headers.get('payment-signature');
    if(signature){if(signature.length>16384)return Response.json({error:'Request too large'},{status:413});headers.set('PAYMENT-SIGNATURE',signature);}
  }
  if (path === 'demo-session' && request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin !== new URL(request.url).origin) return Response.json({ error: 'Same-origin demo access required' }, { status: 403 });
    headers.set('origin', origin);
  }
  if (/^pay\/[A-Za-z0-9_-]+\/customer\/(challenge|verify|session|use|revoke)$/.test(path)) {
    const origin=request.headers.get('origin');
    if(origin!==new URL(request.url).origin)return Response.json({error:'Same-origin customer authentication required'},{status:403});
    headers.set('origin',origin);
  }
  try {
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
    const audio=/^table\/[A-Za-z0-9_-]{43}\/visit\/[A-Za-z0-9_-]{43}\/transcribe$/.test(path);
    if (body && new TextEncoder().encode(body).byteLength > (audio ? 2_900_000 : 1_000_000)) return Response.json({ error: 'Request too large' }, { status: 413 });
    const query = new URL(request.url).search;
    const result = await fetch(`${localApiOrigin(process.env.BITPOS_WEB_API_ORIGIN)}/api/${path}${query}`, { method: request.method, headers, body, redirect: 'error', signal: path.endsWith('/events') ? request.signal : AbortSignal.timeout(30_000) });
    const responseHeaders=new Headers({'Content-Type':result.headers.get('Content-Type')||'application/json','Cache-Control':'no-store'});
    if(/^pay\/[A-Za-z0-9_-]+\/x402$/.test(path))for(const name of ['PAYMENT-REQUIRED','PAYMENT-RESPONSE']){const value=result.headers.get(name);if(value)responseHeaders.set(name,value);}
    return new Response(result.body, { status: result.status, headers:responseHeaders });
  } catch { return Response.json({ error: 'Payment service unavailable' }, { status: 502 }); }
};
