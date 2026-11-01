/**
 * "Use HTTPS" for remote plain-HTTP browsers (PAN-4645 WI-16, D-4645-13).
 *
 * A session or device cookie sent over plain HTTP on the LAN was never safe,
 * so the dashboard refuses to hand its SPA shell or a cookie-delivered pairing
 * to a browser that is remote (not a loopback peer), not on HTTPS (no TLS and no
 * `X-Forwarded-Proto: https` from a local proxy) and not inside a secure
 * channel. Always on, independent of `require_token_mint`. Asset files and
 * every `/api/*` route other than cookie pairing are unaffected;
 * `GET /api/environment` stays reachable on plain HTTP.
 */
import { HttpServerResponse, type HttpServerRequest } from 'effect/unstable/http';

import { type ChannelMarker, channelOfRequest } from './channel-peer.js';
import { isLoopbackPeer } from './routes/dashboard-auth.js';
import { isHttpsRequest } from './routes/dashboard-session.js';

export const USE_HTTPS_DOCS_URL = 'https://overdeck.ai/configuration/remote-access';

/** True for a browser that must switch to HTTPS before it may receive a cookie or the SPA. */
export function isRemotePlainHttpBrowser(
  request: HttpServerRequest.HttpServerRequest,
  channel: ChannelMarker | null = channelOfRequest(request),
): boolean {
  return !isLoopbackPeer(request) && !isHttpsRequest(request) && channel === null;
}

export function useHttpsPage(): HttpServerResponse.HttpServerResponse {
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Use HTTPS</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem;line-height:1.5}code{font-family:ui-monospace,monospace}</style></head>
<body>
<h1>Use HTTPS</h1>
<p>This dashboard opens from other devices only over HTTPS, for example your Tailscale Serve address. On this machine, open <code>http://localhost:3011</code>.</p>
<p><a href="${USE_HTTPS_DOCS_URL}">How to set up remote access</a></p>
</body>
</html>
`;
  return HttpServerResponse.text(html, { status: 403, contentType: 'text/html; charset=utf-8' });
}

/** True for a navigation path (the SPA shell): `/` or any path without a file extension. */
export function isNavigationPath(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return pathname === '/' || !last.includes('.');
}

/**
 * The static route's check: a remote plain-HTTP browser asking for a
 * navigation path gets the "Use HTTPS" page; assets and local or HTTPS
 * requests get `null` and are served normally.
 */
export function plainHttpNavigationGuard(
  request: HttpServerRequest.HttpServerRequest,
  pathname: string,
): HttpServerResponse.HttpServerResponse | null {
  if (!isNavigationPath(pathname)) return null;
  return isRemotePlainHttpBrowser(request) ? useHttpsPage() : null;
}
