import type { HttpServerRequest } from 'effect/unstable/http';

export type HeaderMap = Record<string, string | string[] | undefined>;

let cachedTrustedOrigins: string[] | undefined;

function addTrustedOrigin(origins: Set<string>, raw: string | undefined): void {
  if (!raw) return;
  const normalized = normalizeOrigin(raw.trim());
  if (normalized) origins.add(normalized);
}

export function getTrustedOrigins(): string[] {
  if (cachedTrustedOrigins !== undefined) {
    return cachedTrustedOrigins;
  }
  const port = parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? `http://localhost:${port}`;
  const origins = new Set<string>();
  addTrustedOrigin(origins, dashboardUrl);
  addTrustedOrigin(origins, `http://localhost:${port}`);
  addTrustedOrigin(origins, `http://127.0.0.1:${port}`);

  const trustedOrigins = process.env['PANOPTICON_TRUSTED_ORIGINS'];
  for (const origin of trustedOrigins?.split(',') ?? []) {
    addTrustedOrigin(origins, origin);
  }

  const traefikDomain = process.env['PANOPTICON_TRAEFIK_DOMAIN'] ?? process.env['TRAEFIK_DOMAIN'];
  if (process.env['PANOPTICON_TRAEFIK_ENABLED'] === '1' && traefikDomain) {
    addTrustedOrigin(origins, `https://${traefikDomain}`);
  }

  if (process.env['NODE_ENV'] === 'development') {
    addTrustedOrigin(origins, 'http://localhost:3000');
    addTrustedOrigin(origins, 'http://127.0.0.1:3000');
  }
  cachedTrustedOrigins = Array.from(origins);
  return cachedTrustedOrigins;
}

export function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function getHeaderFromMap(headers: HeaderMap, name: string): string | undefined {
  const direct = headers[name];
  if (Array.isArray(direct)) return direct[0];
  if (direct) return direct;

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function validateOriginHeaders(
  headers: HeaderMap,
  method: string,
): { ok: true } | { ok: false; error: string } {
  const origin = getHeaderFromMap(headers, 'origin');
  const referer = getHeaderFromMap(headers, 'referer');
  const trusted = getTrustedOrigins();

  if (!origin && !referer) {
    const upperMethod = method.toUpperCase();
    if (upperMethod === 'GET' || upperMethod === 'HEAD') {
      return { ok: true };
    }
    return { ok: false, error: 'Missing origin' };
  }

  if (origin) {
    const normalized = normalizeOrigin(origin);
    if (normalized && trusted.includes(normalized)) {
      return { ok: true };
    }
    return { ok: false, error: 'Invalid origin' };
  }

  const normalized = normalizeOrigin(referer);
  if (normalized && trusted.includes(normalized)) {
    return { ok: true };
  }
  return { ok: false, error: 'Invalid referer' };
}

export function validateOrigin(
  request: HttpServerRequest.HttpServerRequest,
): { ok: true } | { ok: false; error: string } {
  return validateOriginHeaders(request.headers as HeaderMap, request.method);
}

export function _resetTrustedOriginsForTests(): void {
  cachedTrustedOrigins = undefined;
}
