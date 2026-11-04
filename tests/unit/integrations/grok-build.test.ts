import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { grokBuildMcpJson } from '../../../src/dashboard/frontend/src/components/Settings/anywhere/botSnippets';

// PAN-4955 W-INT3 WI-1 (AC-manifest.ac1-ac4): the Grok Build plugin manifest, .mcp.json,
// command file, and LICENSE.
const dotGrokPluginJsonPath = new URL('../../../integrations/grok-build/.grok-plugin/plugin.json', import.meta.url);
const pluginJsonPath = new URL('../../../integrations/grok-build/plugin.json', import.meta.url);
const mcpJsonPath = new URL('../../../integrations/grok-build/.mcp.json', import.meta.url);
const commandPath = new URL('../../../integrations/grok-build/commands/overdeck.md', import.meta.url);
const licensePath = new URL('../../../integrations/grok-build/LICENSE', import.meta.url);
const rootLicensePath = new URL('../../../integrations/LICENSE', import.meta.url);
const skillPath = new URL('../../../integrations/grok-build/skills/overdeck/SKILL.md', import.meta.url);

describe('integrations/grok-build manifest', () => {
  it('.grok-plugin/plugin.json and plugin.json are byte-equal and carry the expected keys', () => {
    const dotGrokPluginBuf = readFileSync(dotGrokPluginJsonPath);
    const pluginBuf = readFileSync(pluginJsonPath);

    expect(dotGrokPluginBuf).toEqual(pluginBuf);

    const plugin = JSON.parse(pluginBuf.toString('utf-8'));
    expect(plugin.name).toBe('overdeck');
    expect(plugin.version).toBe('0.1.0');
    expect(plugin.license).toBe('MIT');
    expect(plugin.repository).toBe('https://github.com/eltmon/overdeck');
    expect(plugin.author.name).toBe('Overdeck');
    expect(typeof plugin.description).toBe('string');
    expect(plugin.description.length).toBeGreaterThan(0);
  });

  it('.mcp.json matches grokBuildMcpJson with exactly one server named overdeck', () => {
    const text = readFileSync(mcpJsonPath, 'utf-8');

    expect(text).toBe(grokBuildMcpJson() + '\n');

    const parsed = JSON.parse(text);
    const serverNames = Object.keys(parsed.mcpServers);
    expect(serverNames).toEqual(['overdeck']);
    expect(parsed.mcpServers.overdeck.command).toBe('${GROK_PLUGIN_ROOT}/scripts/run-mcp.sh');
  });

  it('commands/overdeck.md carries the argument hint and points at the skill section', () => {
    const command = readFileSync(commandPath, 'utf-8');

    expect(command).toContain('argument-hint: "<status|pending|answer N CHOICE>"');
    expect(command).toContain('The /overdeck command');
  });

  it('LICENSE is a byte copy of integrations/LICENSE', () => {
    expect(readFileSync(licensePath)).toEqual(readFileSync(rootLicensePath));
  });

  it('the shared skill copy exists', () => {
    expect(existsSync(skillPath)).toBe(true);
  });
});
