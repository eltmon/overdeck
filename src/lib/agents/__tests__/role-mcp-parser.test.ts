import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRoleMcpServersSync, roleSystemPromptInjectionSync } from '../runtime-command.js';

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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'role-mcp-parser-'));
    previousOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = tempDir;
  });

  afterEach(() => {
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
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
});
