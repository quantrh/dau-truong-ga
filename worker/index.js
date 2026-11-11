import { handleRoomRequest } from './rooms.js';
import { HTML, ASSETS, VERSION } from './generated-content.js';

const PUBLIC_ORIGIN = 'https://dau-truong-ga-quan.bidv-it-grou-8424.chatgpt.site';
const allowedOrigins = new Set([PUBLIC_ORIGIN, 'https://quantrh.github.io', 'null']);

function cors(request, response) {
  const origin = request.headers.get('Origin');
  const ownOrigin = new URL(request.url).origin;
  const headers = new Headers(response.headers);
  if (origin && (allowedOrigins.has(origin) || origin === ownOrigin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Max-Age', '600');
    headers.append('Vary', 'Origin');
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const origin = request.headers.get('Origin');
      if (origin && !allowedOrigins.has(origin) && origin !== url.origin) {
        return new Response(JSON.stringify({ error: 'Hãy mở trò chơi từ link được chia sẻ.', code: 'ORIGIN_NOT_ALLOWED' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'OPTIONS') return cors(request, new Response(null, { status: 204 }));
      if (url.pathname === '/api/health') {
        return cors(request, Response.json({ ok: true, version: VERSION }, { headers: { 'Cache-Control': 'no-store' } }));
      }
      return cors(request, await handleRoomRequest(request, env, ctx));
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    if (url.pathname.startsWith('/assets/')) {
      const name = url.pathname.slice('/assets/'.length);
      const asset = ASSETS[name];
      if (!asset || !Object.hasOwn(ASSETS, name)) return new Response('Not found', { status: 404 });
      const headers = { 'Content-Type': asset.mime, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
      const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.base64), c => c.charCodeAt(0));
      return new Response(body, { headers });
    }
    if (url.pathname !== '/' && url.pathname !== '/index.html') return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }
    });
  }
};
