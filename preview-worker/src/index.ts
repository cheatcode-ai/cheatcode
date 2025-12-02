/**
 * Cheatcode Preview Proxy - Cloudflare Worker
 *
 * This proxy removes the Daytona preview warning by adding the
 * X-Daytona-Skip-Preview-Warning header to all requests.
 *
 * URL format: https://preview.trycheatcode.com/{port}-{sandboxId}/path
 * Proxies to: https://{port}-{sandboxId}.proxy.daytona.works/path
 */

const DAYTONA_PROXY_DOMAIN = 'proxy.daytona.works';

interface Env {
  // Add any environment variables here if needed
}

/**
 * Parse the sandbox info from the URL path
 * Format: /{port}-{sandboxId}/rest/of/path
 */
function parseSandboxInfo(pathname: string): { portSandbox: string; remainingPath: string } | null {
  // Match pattern like /3000-abc123-def456-789/some/path
  const match = pathname.match(/^\/(\d+-[a-f0-9-]+)(\/.*)?$/i);
  if (!match) {
    return null;
  }
  return {
    portSandbox: match[1],  // e.g., "3000-abc123-def456-789"
    remainingPath: match[2] || '/'
  };
}

/**
 * Extract sandbox info from Referer header
 * Used for static assets like CSS/JS that use absolute paths
 */
function parseSandboxFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const match = url.pathname.match(/^\/(\d+-[a-f0-9-]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse the sandbox info from the path
    let info = parseSandboxInfo(url.pathname);

    // If path doesn't have sandbox prefix, try to get it from Referer header
    // This handles CSS/JS/images that use absolute paths like /_next/static/...
    if (!info) {
      const referer = request.headers.get('referer');
      const sandboxFromReferer = parseSandboxFromReferer(referer);

      if (sandboxFromReferer) {
        // Use the sandbox from referer and the full path as remaining path
        info = {
          portSandbox: sandboxFromReferer,
          remainingPath: url.pathname
        };
      } else {
        return new Response(JSON.stringify({
          error: 'Invalid URL format',
          message: 'Expected format: /{port}-{sandboxId}/path',
          example: '/3000-abc123-def456-789/index.html'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Build the target URL
    const targetUrl = `https://${info.portSandbox}.${DAYTONA_PROXY_DOMAIN}${info.remainingPath}${url.search}`;

    // Clone the request headers and add our magic headers
    const headers = new Headers(request.headers);
    headers.set('X-Daytona-Skip-Preview-Warning', 'true');
    headers.set('X-Daytona-Disable-CORS', 'true');

    // Remove host header (will be set by fetch)
    headers.delete('host');

    // Create the proxy request
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: 'manual'  // Handle redirects ourselves
    });

    try {
      // Fetch from the target
      const response = await fetch(proxyRequest);

      // Clone the response to modify headers
      const responseHeaders = new Headers(response.headers);

      // Remove X-Frame-Options to allow iframe embedding
      responseHeaders.delete('x-frame-options');
      responseHeaders.delete('X-Frame-Options');

      // Add CORS headers for iframe embedding from trycheatcode.com
      const origin = request.headers.get('origin');
      if (origin && (origin.includes('trycheatcode.com') || origin.includes('localhost'))) {
        responseHeaders.set('Access-Control-Allow-Origin', origin);
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      }

      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 200,
          headers: responseHeaders
        });
      }

      // Return the proxied response with modified headers
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (error) {
      console.error('Proxy error:', error);
      return new Response(JSON.stringify({
        error: 'Proxy Error',
        message: 'Failed to connect to preview server',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
