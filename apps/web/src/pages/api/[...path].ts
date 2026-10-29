import {localApiOrigin} from '../../lib/api-origin';
import type { APIRoute } from 'astro';
import { apiRoutes as routes } from '../../lib/api-routes';
export const prerender = false;

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
