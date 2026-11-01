/**
 * Response helpers and path matching shared by the Worker routes and the Durable Object.
 * Every response is built by json() or withSecurityHeaders(), so each one carries
 * `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
 */

const COMMON_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers({ ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Stamps the common headers onto a response a handler built itself (a 204).
 * A 101 WebSocket upgrade is returned untouched: its headers belong to the handshake.
 */
export function withSecurityHeaders(res: Response): Response {
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [key, value] of Object.entries(COMMON_HEADERS)) out.headers.set(key, value);
  return out;
}

/** `/a/:b` style matching; null when the path does not match or a parameter is empty or malformed. */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i] as string;
    const g = got[i] as string;
    if (w.startsWith(':')) {
      if (g === '') return null;
      try {
        params[w.slice(1)] = decodeURIComponent(g);
      } catch {
        return null;
      }
    } else if (w !== g) {
      return null;
    }
  }
  return params;
}

export function isWebSocketUpgrade(req: Request): boolean {
  return (req.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket';
}
