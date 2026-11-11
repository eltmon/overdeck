import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { connectMessage } from '../../../src/dashboard/frontend/src/components/Settings/anywhere/connectMessage';
import { defaultBotName, grokBotMcpJson, oauthIssueCommand, xaiExample, PUBLIC_MCP_PLACEHOLDER_URL } from '../../../src/dashboard/frontend/src/components/Settings/anywhere/botSnippets';
import { registrationFor, registrationLines } from '../../../src/lib/mcp/connector/connect-output.js';

// PAN-4956 W-INT4 WI-2 (AC-2), WI-5 (AC-5): the Grok Bot plugin manifest, mcp.json, LICENSE,
// README, and a package-wide secret scan.
const pluginJsonPath = new URL('../../../integrations/grok-bot/.cursor-plugin/plugin.json', import.meta.url);
const mcpJsonPath = new URL('../../../integrations/grok-bot/mcp.json', import.meta.url);
const licensePath = new URL('../../../integrations/grok-bot/LICENSE', import.meta.url);
const skillPath = new URL('../../../integrations/grok-bot/skills/overdeck/SKILL.md', import.meta.url);
const rootLicensePath = new URL('../../../integrations/LICENSE', import.meta.url);
const readmePath = new URL('../../../integrations/grok-bot/README.md', import.meta.url);
const grokBotDir = fileURLToPath(new URL('../../../integrations/grok-bot/', import.meta.url));

describe('integrations/grok-bot manifest', () => {
  it('plugin.json carries the expected keys', () => {
    const plugin = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));

    expect(plugin.name).toBe('overdeck');
    expect(plugin.displayName).toBe('Overdeck');
    expect(plugin.version).toBe('0.1.0');
    expect(plugin.license).toBe('MIT');
    expect(plugin.skills).toBe('./skills/');
    expect(plugin.mcpServers).toBe('./mcp.json');
    expect(typeof plugin.description).toBe('string');
    expect(plugin.description.length).toBeGreaterThan(0);
  });

  it('the shared skill copy exists', () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it('mcp.json is the connector registration connect prints for its pinned version', () => {
    const text = readFileSync(mcpJsonPath, 'utf-8');
    const pin = text.match(/@overdeck\/core@(\d+)\.(\d+)\.(\d+)"/);
    expect(pin).not.toBeNull();
    const [major, minor] = [Number(pin![1]), Number(pin![2])];
    expect(major > 0 || minor >= 75).toBe(true); // 0.75.0 is the first release with `connect`
    const version = `${pin![1]}.${pin![2]}.${pin![3]}`;
    expect(text).toBe(registrationLines('grok-bot', registrationFor({ version, env: {} })).slice(1).join('\n') + '\n');
  });

  it('LICENSE is a byte copy of integrations/LICENSE', () => {
    expect(readFileSync(licensePath)).toEqual(readFileSync(rootLicensePath));
  });
});

describe('integrations/grok-bot README', () => {
  it('contains the dialog snippets verbatim and names both examples', () => {
    const readme = readFileSync(readmePath, 'utf-8');

    expect(readme).toContain(grokBotMcpJson({ url: PUBLIC_MCP_PLACEHOLDER_URL }));
    expect(readme).toContain(xaiExample({ url: PUBLIC_MCP_PLACEHOLDER_URL }));
    expect(readme).toContain(oauthIssueCommand({ name: 'xai-api', level: 'read' }));
    expect(readme).toContain('examples/xai-api.ts');
    expect(readme).toContain('examples/xai-api.py');
  });

  it('leads with the one-paste flow and its Copy message', () => {
    const readme = readFileSync(readmePath, 'utf-8');

    expect(readme.match(/^## .*/m)?.[0]).toBe('## Connect in one paste');
    expect(readme).toContain(
      connectMessage({ platform: 'grok-bot', botName: defaultBotName('grok-bot'), machineLabel: '<machine>', version: '<version>', pairingString: '<pairing string>' }),
    );
    expect(readme).toContain(readFileSync(mcpJsonPath, 'utf-8').trimEnd());
  });
});

describe('integrations/grok-bot secrets', () => {
  it('no file contains a token-shaped string', () => {
    const TOKEN_PATTERN = /\bod[klr]_[0-9a-f]{16,}/;
    let visited = 0;

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
          continue;
        }
        visited += 1;
        const content = readFileSync(entryPath, 'utf-8');
        expect(content).not.toMatch(TOKEN_PATTERN);
      }
    }

    walk(grokBotDir);
    expect(visited).toBeGreaterThanOrEqual(7);
  });
});
