/**
 * Vercel Edge Function — same-origin proxy from the static UI to the Render backend.
 *
 * Why a proxy: the browser only ever talks to your Vercel domain, so session cookies stay first-party
 * (SameSite=Lax, no third-party-cookie breakage) and the backend URL is never exposed to the page.
 * Streaming responses (chat, agent SSE) are passed through without buffering.
 *
 * Required Vercel env var:  BACKEND_URL = https://<your-service>.onrender.com   (no trailing path)
 */
export const config = { runtime: 'edge' };

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

function fail(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function handler(request) {
  const backend = (process.env.BACKEND_URL || '').trim();
  if (!/^https:\/\//i.test(backend)) {
    return fail(500, 'BACKEND_URL is not configured (must be an https:// URL).');
  }

  const incoming = new URL(request.url);
  const captured = incoming.searchParams.get('path');
  const pathname = captured !== null ? `/api/${captured}` : incoming.pathname;
  incoming.searchParams.delete('path');

  // Only ever forward to /api/* on the configured backend — never an arbitrary host or path.
  if (!pathname.startsWith('/api/') || pathname.includes('..')) return fail(400, 'Bad path');
  const target = new URL(pathname + (incoming.search || ''), backend);
  if (target.origin !== new URL(backend).origin) return fail(400, 'Bad target');

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || k.startsWith('x-vercel-') || k.startsWith('x-forwarded-')) return;
    headers.set(key, value);
  });
  headers.set('x-forwarded-proto', 'https');
  headers.set('x-forwarded-host', incoming.host);
  const clientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (clientIp) headers.set('x-forwarded-for', clientIp);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
      duplex: 'half',
    });
  } catch {
    return fail(502, 'Backend unreachable. If it is on a free plan it may be waking up — retry in a minute.');
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.append(key, value);
  });
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
