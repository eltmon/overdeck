/**
 * PAN-4927 W-INJ1 (PAN-4932): the `mcp:` block in config.yaml. Normalization never throws.
 *
 * `agents` turns the `overdeck` MCP server for managed agents on or off (default on).
 * `public.enabled` is read by W-FUN1; this item only adds and normalizes it.
 */

/** Raw `mcp:` block as it appears in config.yaml. Every field is optional. */
export interface McpYamlConfig {
  agents?: boolean;
  public?: { enabled?: boolean };
}

export interface NormalizedMcpConfig {
  agents: boolean;
  public: { enabled: boolean };
}

export function defaultMcpConfig(): NormalizedMcpConfig {
  return { agents: true, public: { enabled: false } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Fold one layer's `mcp:` block onto the merged value. Non-boolean values are ignored. */
export function mergeMcpConfig(result: NormalizedMcpConfig, config: { mcp?: McpYamlConfig } | null): void {
  const raw: unknown = config?.mcp;
  if (!isPlainObject(raw)) return;
  if (typeof raw['agents'] === 'boolean') result.agents = raw['agents'];
  const pub = raw['public'];
  if (isPlainObject(pub) && typeof pub['enabled'] === 'boolean') result.public.enabled = pub['enabled'];
}
