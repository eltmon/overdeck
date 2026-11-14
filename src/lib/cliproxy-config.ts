/**
 * cliproxy-config.ts
 *
 * Pure builder for CLIProxy's v8 `config.yaml` (CLIProxyAPI v8.0.71+, PAN-5282).
 *
 * The v8 layout starts with `config-version: 8` and nests settings under
 * `server:`, `access:`, `management:`, `routing:`, `observability:` and
 * `oauth:`. In v8 the root `api-keys:` is a mapping of upstream provider
 * groups (`api-keys.gemini`, …); the client keys Overdeck's own agents send
 * live in `access.api-keys`.
 *
 * This module does no I/O. Host, port, client token, auth dir, Gemini key and
 * management key come in as arguments, so it never imports `cliproxy.ts`
 * (that keeps `npm run lint:circular` clean). File reads and writes live in
 * `cliproxy-config-files.ts`; the lifecycle in `cliproxy.ts`.
 */

import { stringify as stringifyYaml } from 'yaml';

export interface CliproxyConfigInput {
  host: string;
  port: number;
  clientToken: string;
  authDir: string;
  geminiApiKey: string | null;
  managementKey: string;
  extra: Record<string, unknown>;
}

export interface CliproxyConfigOutput {
  config: Record<string, unknown>;
  yaml: string;
  activeManagementKey: string;
  warnings: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a bcrypt hash such as the one CLIProxy writes over a plaintext secret-key. */
export function isBcryptHash(value: unknown): boolean {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

/**
 * Deep merge: plain objects merge key by key; arrays, scalars and null from
 * `over` replace the base value. Neither input is mutated.
 */
export function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out;
}

/** Legacy (v7 flat) top-level keys and the v8 path each one moves to. */
const LEGACY_KEY_PATHS: Record<string, readonly string[]> = {
  host: ['server', 'host'],
  port: ['server', 'port'],
  'remote-management': ['management'],
  'request-retry': ['routing', 'retry', 'request-retry'],
  'max-retry-interval': ['routing', 'retry', 'max-retry-interval'],
  debug: ['observability', 'logs', 'debug'],
  'proxy-url': ['requests', 'proxy-url'],
  'auth-dir': ['oauth', 'auth-dir'],
  'oauth-model-alias': ['oauth', 'model-alias'],
  'oauth-excluded-models': ['oauth', 'excluded-models'],
};

function nestAt(path: readonly string[], value: unknown): Record<string, unknown> {
  let node: unknown = value;
  for (let i = path.length - 1; i >= 0; i--) node = { [path[i]!]: node };
  return node as Record<string, unknown>;
}

/**
 * Convert the legacy keys of an operator `config.extra.yaml` to v8 paths.
 * A root `api-keys` list is the legacy client-key list (→ `access.api-keys`);
 * a mapping is already the v8 provider-group shape and stays. Extra's
 * v8-spelled keys merge over the converted legacy keys, so a v8 key beats
 * its legacy twin. Every other key passes through (v8 still reads it).
 */
export function convertLegacyKeys(extra: Record<string, unknown>): Record<string, unknown> {
  let legacy: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    const path = LEGACY_KEY_PATHS[key];
    if (path) {
      legacy = deepMerge(legacy, nestAt(path, value));
    } else if (key === 'api-keys' && Array.isArray(value)) {
      legacy = deepMerge(legacy, nestAt(['access', 'api-keys'], value));
    } else {
      rest[key] = value;
    }
  }
  return deepMerge(legacy, rest);
}

function sectionOf(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = config[key];
  const section = isPlainObject(current) ? { ...current } : {};
  config[key] = section;
  return section;
}

/**
 * Build the generated v8 config object and its YAML text: Overdeck's base
 * config with `extra` (legacy keys converted) deep-merged over it. Extra wins,
 * except that Overdeck's client token always stays in `access.api-keys`.
 */
export function buildCliproxyConfigV8(input: CliproxyConfigInput): CliproxyConfigOutput {
  const { host, port, clientToken, authDir, geminiApiKey, managementKey } = input;
  const base: Record<string, unknown> = {
    'config-version': 8,
    server: { host, port },
    access: { 'api-keys': [clientToken] },
    management: { 'allow-remote': false, 'secret-key': managementKey },
    routing: { strategy: 'round-robin', 'session-affinity': true, 'session-affinity-ttl': '1h' },
    observability: { logs: { debug: false } },
    oauth: { 'auth-dir': authDir },
    ...(geminiApiKey
      ? { 'api-keys': { gemini: [{ name: 'overdeck-gemini', keys: [{ 'api-key': geminiApiKey }] }] } }
      : {}),
  };
  const config = deepMerge(base, convertLegacyKeys(input.extra));
  const warnings: string[] = [];

  // Overdeck's own clients authenticate with clientToken; extra cannot drop it.
  const access = sectionOf(config, 'access');
  const clientKeys = access['api-keys'];
  if (!Array.isArray(clientKeys)) access['api-keys'] = [clientToken];
  else if (!clientKeys.includes(clientToken)) access['api-keys'] = [...clientKeys, clientToken];

  // A plaintext secret-key from extra wins; a bcrypt hash cannot be sent as a
  // Bearer key, so it falls back to the management-key file's key.
  const management = sectionOf(config, 'management');
  const extraKey = management['secret-key'];
  let activeManagementKey = managementKey;
  if (typeof extraKey === 'string' && extraKey.length > 0 && !isBcryptHash(extraKey)) {
    activeManagementKey = extraKey;
  } else {
    management['secret-key'] = managementKey;
    if (isBcryptHash(extraKey)) {
      warnings.push('config.extra.yaml management secret-key is a bcrypt hash; using the key in management-key instead');
    }
  }

  return {
    config,
    yaml: stringifyYaml(config, { lineWidth: 0 }),
    activeManagementKey,
    warnings,
  };
}
