import type { HttpServerRequest } from 'effect/unstable/http';

let cachedTrustedOrigins: string[] | undefined;

export function getTrustedOrigins(): string[] {
  if (cachedTrustedOrigins !== undefined) {
    return cachedTrustedOrigins;
  }
  const port = parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? `http://localhost:${port}`;
  const origins = new Set<string>();
  origins.add(dashboardUrl);
  origins.add(`http://localhost:${port}`);
  origins.add(`http://127.0.0.1:${port}`);
  if (process.env['NODE_ENV'] === 'development') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
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

function getHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function isTrustedOriginForHost(origin: string, host: string | undefined): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (getTrustedOrigins().includes(normalized)) return true;
  if (!host) return false;
  try {
    const originHost = new URL(normalized).host;
    const requestHost = host.split(',')[0]?.trim();
    if (!requestHost) return false;
    return originHost === requestHost || `api-${originHost}` === requestHost;
  } catch {
    return false;
  }
}

export function validateOrigin(
  request: HttpServerRequest.HttpServerRequest,
): { ok: true } | { ok: false; error: string } {
  const origin = getHeader(request, 'origin');
  const referer = getHeader(request, 'referer');

  if (!origin && !referer) {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      return { ok: true };
    }
    return { ok: false, error: 'Missing origin' };
  }

  if (origin) {
    if (isTrustedOriginForHost(origin, getHeader(request, 'host'))) {
      return { ok: true };
    }
    return { ok: false, error: 'Invalid origin' };
  }

  if (isTrustedOriginForHost(referer, getHeader(request, 'host'))) {
    return { ok: true };
  }
  return { ok: false, error: 'Invalid referer' };
}

export function _resetTrustedOriginsForTests(): void {
  cachedTrustedOrigins = undefined;
}
