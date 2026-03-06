/**
 * Cheatcode API Proxy - Cloudflare Worker
 * Proxies requests from api.trycheatcode.com to Cloud Run
 */

const CLOUD_RUN_URL = 'https://cheatcode-api-l4gsl5sf5a-el.a.run.app';

function isAllowedOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'trycheatcode.com'
      || hostname === 'www.trycheatcode.com'
      || hostname === 'localhost';
  } catch {
    return false;
  }
}

// Simple in-memory rate limiting (100 req/min per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

export default {
  async fetch(request: Request): Promise<Response> {
    // Rate limit by IP
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }

    const url = new URL(request.url);

    // Build target URL
    const targetUrl = `${CLOUD_RUN_URL}${url.pathname}${url.search}`;

    // Clone headers
    const headers = new Headers(request.headers);
    headers.delete('host');

    // Proxy request
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual'
    });

    try {
      const response = await fetch(proxyRequest);

      // Clone response headers
      const responseHeaders = new Headers(response.headers);

      // Add CORS headers
      const origin = request.headers.get('origin');
      if (origin && isAllowedOrigin(origin)) {
        responseHeaders.set('Access-Control-Allow-Origin', origin);
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      }

      // Handle preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: responseHeaders });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: 'Proxy Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
