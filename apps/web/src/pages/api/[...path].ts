import type { APIRoute } from 'astro';
export const prerender = false;
const routes: [RegExp, readonly string[]][] = [
  [/^session$/, ['GET', 'POST', 'DELETE']],
  [/^demo-session$/, ['GET', 'POST']],
  [/^table\/[A-Za-z0-9_-]{43}$/, ['GET']],
  [/^table\/[A-Za-z0-9_-]{43}\/visit$/, ['POST']],
  [/^table\/[A-Za-z0-9_-]{43}\/visit\/[A-Za-z0-9_-]{43}$/, ['GET']],
  [/^table\/[A-Za-z0-9_-]{43}\/visit\/[A-Za-z0-9_-]{43}\/(quotes|orders|release|dismiss)$/, ['POST']],
  [/^menu$/, ['GET']], [/^settings$/, ['GET', 'PUT']],
  [/^settings\/pricing$/, ['GET', 'PUT']],
  [/^(tables|devices|registers)$/, ['GET', 'POST']],
  [/^(tables|devices)\/[A-Za-z0-9_-]+$/, ['PATCH']],
  [/^devices\/[A-Za-z0-9_-]+\/credential$/, ['POST', 'DELETE']],
  [/^registers\/[A-Za-z0-9_-]+\/pairing$/, ['PUT']],
  [/^registers\/[A-Za-z0-9_-]+\/(quotes|orders)$/, ['POST']],
  [/^registers\/[A-Za-z0-9_-]+\/orders\/[A-Za-z0-9_-]+\/dismiss$/, ['POST']],
  [/^registers\/[A-Za-z0-9_-]+\/submissions\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^products\/[A-Za-z0-9_-]+\/offer$/, ['GET', 'PUT', 'PATCH']],
  [/^customers$/, ['GET', 'POST']], [/^customers\/[A-Za-z0-9_-]+$/, ['PATCH']],
  [/^customers\/[A-Za-z0-9_-]+\/history$/, ['GET']],
  [/^orders$/, ['GET']], [/^orders\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^orders\/[A-Za-z0-9_-]+\/(recovery|cancel)$/, ['POST']],
  [/^pay\/[A-Za-z0-9_-]+$/, ['GET']],
  [/^pay\/[A-Za-z0-9_-]+\/events$/, ['GET']],
  [/^pay\/[A-Za-z0-9_-]+\/(challenge|bind|attempt|submit|dismiss)$/, ['POST']],
];
export const ALL: APIRoute = async ({ request, params }) => {
  const path = params.path || '';
  const route = routes.find(([pattern]) => pattern.test(path));
  if (!route) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!route[1].includes(request.method)) return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const headers = new Headers();
  for (const name of ['authorization', 'content-type']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  if (path === 'demo-session' && request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin !== new URL(request.url).origin) return Response.json({ error: 'Same-origin demo access required' }, { status: 403 });
    headers.set('origin', origin);
  }
  try {
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
    if (body && body.length > 1_000_000) return Response.json({ error: 'Request too large' }, { status: 413 });
    const query = new URL(request.url).search;
    const result = await fetch(`http://127.0.0.1:3001/api/${path}${query}`, { method: request.method, headers, body, redirect: 'error', signal: path.endsWith('/events') ? request.signal : AbortSignal.timeout(30_000) });
    return new Response(result.body, { status: result.status, headers: { 'Content-Type': result.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Payment service unavailable' }, { status: 502 }); }
};
