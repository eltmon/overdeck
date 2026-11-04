import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../merge.js';
import { defaultMcpConfig, mergeMcpConfig, type McpYamlConfig } from '../mcp-config.js';

function merged(...layers: unknown[]) {
  const result = defaultMcpConfig();
  for (const layer of layers) mergeMcpConfig(result, layer as { mcp?: McpYamlConfig } | null);
  return result;
}

describe('config-yaml mcp block (PAN-4932)', () => {
  it('defaults to agents on and public off', () => {
    expect(defaultMcpConfig()).toEqual({ agents: true, public: { enabled: false } });
    expect(merged(null, {})).toEqual({ agents: true, public: { enabled: false } });
  });

  it('turns agent injection off', () => {
    expect(merged({ mcp: { agents: false } }).agents).toBe(false);
  });

  it('ignores a non-boolean agents value and keeps the earlier value', () => {
    expect(merged({ mcp: { agents: 'no' } }).agents).toBe(true);
    expect(merged({ mcp: { agents: false } }, { mcp: { agents: 'yes' } }).agents).toBe(false);
  });

  it('keeps the defaults for a null or array block without throwing', () => {
    expect(() => merged({ mcp: null }, { mcp: [] }, { mcp: 'on' })).not.toThrow();
    expect(merged({ mcp: null })).toEqual(defaultMcpConfig());
    expect(merged({ mcp: [] })).toEqual(defaultMcpConfig());
  });

  it('sets public.enabled only from a boolean in a mapping', () => {
    expect(merged({ mcp: { public: { enabled: true } } }).public.enabled).toBe(true);
    expect(merged({ mcp: { public: { enabled: 'true' } } }).public.enabled).toBe(false);
    expect(merged({ mcp: { public: true } }).public.enabled).toBe(false);
  });

  it('lets a later layer override an earlier one', () => {
    expect(merged({ mcp: { agents: false } }, { mcp: { agents: true } }).agents).toBe(true);
    expect(merged({ mcp: { public: { enabled: true } } }, { mcp: { public: { enabled: false } } }).public.enabled).toBe(false);
  });

  it('flows through mergeConfigs', () => {
    expect(mergeConfigs(null).config.mcp).toEqual({ agents: true, public: { enabled: false } });
    expect(mergeConfigs({ mcp: { agents: false } }).config.mcp.agents).toBe(false);
  });
});
