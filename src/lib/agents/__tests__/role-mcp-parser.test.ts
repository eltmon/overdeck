import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCodexLauncherFields, parseRoleMcpServersSync, roleSystemPromptInjectionSync } from '../runtime-command.js';

const ROLE = `---
name: test
tools:
  - Read
  - Bash
mcpServers:
  - playwright:
      type: stdio
      command: npx
      args:
        - "-y"
        - "@playwright/mcp@latest"
---
Test role body.
`;

describe('parseRoleMcpServersSync', () => {
  let tempDir: string;
  let previousOverdeckHome: string | undefined;
  let previousHome: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'role-mcp-parser-'));
    previousOverdeckHome = process.env.OVERDECK_HOME;
    previousHome = process.env.HOME;
    process.env.OVERDECK_HOME = tempDir;
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('flattens the test role Playwright server definition', () => {
    const rolePath = join(tempDir, 'test.md');
    writeFileSync(rolePath, ROLE);

    expect(parseRoleMcpServersSync(rolePath)).toEqual({
      playwright: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest'],
      },
    });
  });

  it('returns an empty record for missing, absent, or malformed frontmatter', () => {
    const absentPath = join(tempDir, 'absent.md');
    const malformedPath = join(tempDir, 'malformed.md');
    writeFileSync(absentPath, 'No frontmatter here.');
    writeFileSync(malformedPath, '---\nmcpServers: [\n---\nBody');

    expect(parseRoleMcpServersSync(join(tempDir, 'missing.md'))).toEqual({});
    expect(parseRoleMcpServersSync(absentPath)).toEqual({});
    expect(parseRoleMcpServersSync(malformedPath)).toEqual({});
  });

  it('preserves Claude role MCP config and allowed-tools flags', () => {
    const rolePath = join(tempDir, 'test.md');
    writeFileSync(rolePath, ROLE);

    const flags = roleSystemPromptInjectionSync(rolePath);
    const mcpPath = join(tempDir, 'role-prompts', 'test.mcp.json');

    expect(flags).toContain(` --mcp-config '${mcpPath}'`);
    expect(flags).toContain(" --allowedTools 'Read,Bash,mcp__playwright'");
    expect(JSON.parse(readFileSync(mcpPath, 'utf8'))).toEqual({
      mcpServers: parseRoleMcpServersSync(rolePath),
    });
  });

  it('preserves role MCP servers across Codex home rewrites', () => {
    const fields = getCodexLauncherFields('agent-test-mcp', 'gpt-5.6', tempDir, 'test');
    getCodexLauncherFields('agent-test-mcp', 'gpt-5.6', tempDir, 'test');

    const config = readFileSync(join(fields.codexHome, 'config.toml'), 'utf8');
    expect(config).toContain('[mcp_servers.playwright]');
    expect(config).toContain('command = "npx"');
    expect(config).toContain('args = ["-y", "@playwright/mcp@latest"]');
  });

  it('writes no MCP section for a role without declared servers', () => {
    const fields = getCodexLauncherFields('agent-work-no-mcp', 'gpt-5.6', tempDir, 'work');
    const config = readFileSync(join(fields.codexHome, 'config.toml'), 'utf8');

    expect(config).not.toContain('[mcp_servers');
  });
});
