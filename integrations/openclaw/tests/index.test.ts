import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import plugin from '../src/index.js';
import type { OpenClawPluginApi, PluginTool } from '../src/openclaw-api.js';

// Built at runtime so no committed file carries a token-shaped literal (NFR-1).
const TOKEN = ['odl', 'c'.repeat(64)].join('_');
const MANIFEST = JSON.parse(readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8')) as Record<string, unknown> & {
  id: string;
  contracts: { tools: string[] };
  configSchema: unknown;
};

function fakeApi(pluginConfig: Record<string, unknown> | undefined) {
  const tools: PluginTool[] = [];
  const api = {
    pluginConfig,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerTool: vi.fn((tool: PluginTool) => { tools.push(tool); }),
    on: vi.fn(),
  } satisfies OpenClawPluginApi;
  plugin.register(api);
  return { api, tools };
}

describe('plugin entry', () => {
  it('is a plain plugin definition matching the manifest', () => {
    expect(Object.keys(plugin).sort()).toEqual(['configSchema', 'description', 'id', 'name', 'register']);
    expect(plugin.id).toBe(MANIFEST.id);
    expect(plugin.configSchema).toEqual(MANIFEST.configSchema);
  });

  it('uses only documented manifest keys', () => {
    for (const key of ['entry', 'license', 'author']) expect(MANIFEST).not.toHaveProperty(key);
  });

  it('registers the contracted tools and one summary hook for a valid config', () => {
    const { api, tools } = fakeApi({ localToken: TOKEN });
    expect(tools.map((tool) => tool.name)).toEqual(MANIFEST.contracts.tools);
    expect(api.on).toHaveBeenCalledTimes(1);
    expect(api.on).toHaveBeenCalledWith('before_prompt_build', expect.any(Function));
    expect(api.logger.warn).not.toHaveBeenCalled();
  });

  it('registers no hook when summary is false', () => {
    const { api, tools } = fakeApi({ localToken: TOKEN, summary: false });
    expect(tools).toHaveLength(2);
    expect(api.on).not.toHaveBeenCalled();
  });

  it('still registers both tools for a refused URL, answers the setup error, and warns without the token', async () => {
    const { api, tools } = fakeApi({ connectorUrl: 'http://example.com/mcp', localToken: TOKEN });
    expect(tools.map((tool) => tool.name)).toEqual(MANIFEST.contracts.tools);
    expect(api.on).not.toHaveBeenCalled();
    const result = await tools[0]!.execute('1', {});
    expect(result.content[0]!.text).toBe('Overdeck is not set up: connectorUrl must use https://, or http:// on 127.0.0.1, localhost or [::1]');
    expect(api.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(api.logger.warn.mock.calls[0]![0])).not.toContain(TOKEN);
  });

  it('answers a missing token from the tools', async () => {
    const { api, tools } = fakeApi(undefined);
    expect(tools).toHaveLength(2);
    expect(api.on).not.toHaveBeenCalled();
    expect((await tools[0]!.execute('1', {})).content[0]!.text).toBe('Overdeck is not set up: localToken is not set (plugins.entries.overdeck.config.localToken)');
  });
});
