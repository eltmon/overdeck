/**
 * Response builders, security headers (D-28), cookies and the 16 KiB request-body guard.
 *
 * `html()` is the only producer of text/html responses, so the Content-Security-Policy cannot be forgotten.
 * No response ever carries an Access-Control-* header: /v1/* is server-to-server, never a browser caller.
 */

export const MAX_BODY_BYTES = 16 * 1024;

export const HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'";

const COMMON_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const HTML_HEADERS: Record<string, string> = {
  ...COMMON_HEADERS,
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': HTML_CSP,
  'Referrer-Policy': 'no-referrer',
};

function withHeaders(base: Record<string, string>, extra?: HeadersInit): Headers {
  const headers = new Headers(base);
  if (extra) new Headers(extra).forEach((value, key) => headers.append(key, value));
  return headers;
}

export function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withHeaders({ ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }, extra),
  });
}

export function html(body: string, status = 200, extra?: HeadersInit): Response {
  return new Response(body, { status, headers: withHeaders(HTML_HEADERS, extra) });
}

export function redirect(location: string, status: 302 | 303 = 302, extra?: HeadersInit): Response {
  return new Response(null, { status, headers: withHeaders({ ...COMMON_HEADERS, Location: location }, extra) });
}

export function noContent(extra?: HeadersInit): Response {
  return new Response(null, { status: 204, headers: withHeaders(COMMON_HEADERS, extra) });
}

/** Placeholder body for handler modules that a later work item implements. */
export function notImplemented(): Response {
  return json({ error: 'not_implemented' }, 501);
}

export type BodyGuardResult = { ok: true; req: Request } | { ok: false; response: Response };

/**
 * Reads the request body with a running byte count and refuses anything over 16 KiB with 413.
 * Content-Length is not trusted (it may be absent or wrong); the stream is what counts.
 * On success the body is handed back inside a fresh Request so handlers can still call `text()`/`formData()`.
 */
export async function guardBody(req: Request): Promise<BodyGuardResult> {
  if (req.body === null) return { ok: true, req };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, response: json({ error: 'payload_too_large', maxBytes: MAX_BODY_BYTES }, 413) };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, req: new Request(req.url, { method: req.method, headers: req.headers, body }) };
}

/** Parses an `application/x-www-form-urlencoded` body; null when the content type is anything else. */
export async function readForm(req: Request): Promise<URLSearchParams | null> {
  const contentType = req.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) return null;
  return new URLSearchParams(await req.text());
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = req.headers.get('Cookie');
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export interface CookieOptions {
  maxAgeS: number;
  sameSite?: 'Lax' | 'Strict';
}

/** `__Host-` cookies: HttpOnly, Secure, Path=/ and no Domain are required by the prefix (D-20, D-21). */
export function setCookie(name: string, value: string, opts: CookieOptions): string {
  return `${name}=${value}; HttpOnly; Secure; SameSite=${opts.sameSite ?? 'Lax'}; Path=/; Max-Age=${opts.maxAgeS}`;
}

export function clearCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
