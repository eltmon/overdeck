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
}

/** Build the generated v8 config object and its YAML text. */
export function buildCliproxyConfigV8(input: CliproxyConfigInput): CliproxyConfigOutput {
  const { host, port, clientToken, authDir, geminiApiKey, managementKey } = input;
  const config: Record<string, unknown> = {
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
  return {
    config,
    yaml: stringifyYaml(config, { lineWidth: 0 }),
    activeManagementKey: managementKey,
  };
}
