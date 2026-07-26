import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { HttpServerRequest } from 'effect/unstable/http';

export type HeaderMap = Record<string, string | string[] | undefined>;

let cachedTrustedOrigins: string[] | undefined;

function addTrustedOrigin(origins: Set<string>, raw: string | undefined): void {
  if (!raw) return;
  const normalized = normalizeOrigin(raw.trim());
  if (normalized) origins.add(normalized);
}

interface TraefikYamlConfig {
  enabled: boolean;
  domain: string;
}

/**
 * Last-resort origin config for launches that carry no origin env at all
 * (manual `node dist/...`, ad-hoc re-exec). `pan up` builds its launch env from
 * this same config.yaml, so reading it here keeps every launch path trusting the
 * same Traefik domain instead of 403ing /ws/* into a "Reconnecting" loop.
 */
function readTraefikConfigFromYaml(): TraefikYamlConfig | null {
  try {
    const home = process.env['OVERDECK_HOME'] || join(homedir(), '.overdeck');
    const configPath = join(home, 'config.yaml');
    if (!existsSync(configPath)) return null;
    const parsed = yaml.load(readFileSync(configPath, 'utf8')) as
      | { traefik?: { enabled?: unknown; domain?: unknown } }
      | null
      | undefined;
    const traefik = parsed?.traefik;
    if (!traefik || typeof traefik !== 'object') return null;
    if (typeof traefik.domain !== 'string' || traefik.domain.trim() === '') return null;
    return { enabled: traefik.enabled === true, domain: traefik.domain.trim() };
  } catch {
    return null; // unreadable/invalid config → env-only behavior, same as before
  }
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
  addTrustedOrigin(origins, 'http://localhost:3010');
  addTrustedOrigin(origins, 'http://127.0.0.1:3010');

  const trustedOrigins = process.env['OVERDECK_TRUSTED_ORIGINS'];
  for (const origin of trustedOrigins?.split(',') ?? []) {
    addTrustedOrigin(origins, origin);
  }

  const traefikDomain = process.env['OVERDECK_TRAEFIK_DOMAIN'] ?? process.env['TRAEFIK_DOMAIN'];
  if (process.env['OVERDECK_TRAEFIK_ENABLED'] === '1' && traefikDomain) {
    addTrustedOrigin(origins, `https://${traefikDomain}`);
  }

  // Bare-launch fallback: when the launcher provided NO origin configuration at
  // all, trust the domain from the operator's config.yaml. Any explicit env
  // (even an explicit disable) wins over the file.
  const hasEnvOriginConfig =
    process.env['OVERDECK_TRAEFIK_ENABLED'] !== undefined ||
    traefikDomain !== undefined ||
    process.env['OVERDECK_TRUSTED_ORIGINS'] !== undefined;
  if (!hasEnvOriginConfig) {
    const fromYaml = readTraefikConfigFromYaml();
    if (fromYaml?.enabled) {
      addTrustedOrigin(origins, `https://${fromYaml.domain}`);
    }
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

  if (!referer) {
    return { ok: false, error: 'Invalid referer' };
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

/**
 * Origin trust check used by raw WebSocket upgrade paths (autopreso, voice).
 * Only explicitly configured dashboard origins are trusted; the request Host
 * header is attacker-controlled and must not influence this decision.
 */
export function isTrustedOriginForHost(
  origin: string | undefined,
  _host: string | string[] | undefined,
): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return getTrustedOrigins().includes(normalized);
}
