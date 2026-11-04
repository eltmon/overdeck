/**
 * PAN-4927 W-FUN1 (PAN-4947): the opt-in public MCP surface through Tailscale Funnel.
 * The switch is `mcp.public.enabled` in the operator's global config.yaml only (a
 * project .pan.yaml can never turn it on). The gate reads it on every Funnel request,
 * so the value is cached until `invalidatePublicMcpConfig()`; a missing or broken
 * file reads as off. Overdeck prints the Funnel commands and never runs `tailscale`.
 *
 * This is the read side; the write door is `public-mcp-write.ts`. It must not import
 * `settings-api.ts`, because the request gate imports it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { defaultMcpConfig, mergeMcpConfig, type McpYamlConfig } from '../config-yaml/mcp-config.js';
import { getOverdeckHome } from '../paths.js';
import { TRIGGER_FUNNEL_PORT, triggerDashboardPort } from '../triggers/setup.js';

export const PUBLIC_MCP_FUNNEL_PORT = TRIGGER_FUNNEL_PORT; // 8443, shared with /hooks
export const PUBLIC_MCP_MOUNTS = ['/mcp', '/.well-known', '/oauth'] as const;
export const PUBLIC_MCP_SURFACES: ReadonlySet<string> = new Set([
  'POST /mcp',
  'GET /.well-known/oauth-protected-resource',
  'GET /.well-known/oauth-protected-resource/mcp',
  'GET /.well-known/oauth-authorization-server',
  'POST /oauth/mcp/register',
  'GET /oauth/mcp/authorize',
  'GET /oauth/mcp/authorize/status',
  'POST /oauth/mcp/token',
  'POST /oauth/mcp/revoke',
]);

/** `METHOD rawPath` when it is exactly a public surface (D-4: no decoding, no normalization), else null. */
export function publicMcpSurface(method: string, url: string): string | null {
  const rawPath = url.split(/[?#]/, 1)[0];
  const surface = `${method} ${rawPath}`;
  return PUBLIC_MCP_SURFACES.has(surface) ? surface : null;
}

let cached: boolean | undefined;

/** D-1: the global-only switch, cached until `invalidatePublicMcpConfig()`; false on any error. */
export function isPublicMcpEnabled(): boolean {
  if (cached !== undefined) return cached;
  try {
    const parsed = yaml.load(readFileSync(join(getOverdeckHome(), 'config.yaml'), 'utf8'));
    const merged = defaultMcpConfig();
    mergeMcpConfig(merged, parsed as { mcp?: McpYamlConfig } | null);
    cached = merged.public.enabled;
  } catch {
    cached = false;
  }
  return cached;
}

export function invalidatePublicMcpConfig(): void {
  cached = undefined;
}

/** D-10: the three Funnel mounts that publish the public surfaces on port 8443. */
export function publicMcpFunnelCommands(port = triggerDashboardPort()): string[] {
  return PUBLIC_MCP_MOUNTS.map(
    (mount) => `tailscale funnel --bg --https=${PUBLIC_MCP_FUNNEL_PORT} --set-path=${mount} http://127.0.0.1:${port}${mount}`,
  );
}

export function publicMcpFunnelOffCommands(): string[] {
  return PUBLIC_MCP_MOUNTS.map((mount) => `tailscale funnel --https=${PUBLIC_MCP_FUNNEL_PORT} --set-path=${mount} off`);
}
