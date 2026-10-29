import type { APIRoute } from 'astro';
import { localApiOrigin } from '../../../lib/api-origin';
export const prerender = false;

// Public product photo. Bytes live in the BitPOS database (product_images); this route only streams them from the API
// with the API's own content type, so the browser never sniffs and the response can be cached forever (id is immutable).
export const GET: APIRoute = async ({ params }) => {
  const id = params.id ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  try {
    const upstream = await fetch(`${localApiOrigin(process.env.BITPOS_WEB_API_ORIGIN)}/api/product-images/${id}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const type = upstream.headers.get('Content-Type') ?? '';
    if (!upstream.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) return new Response('Not found', { status: upstream.status === 404 || upstream.ok ? 404 : 502, headers: { 'Cache-Control': 'no-store' } });
    return new Response(upstream.body, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", ...(upstream.headers.get('ETag') ? { ETag: upstream.headers.get('ETag')! } : {}) } });
  } catch { return new Response('Image service unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } }); }
};
