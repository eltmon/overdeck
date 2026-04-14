import { describe, it, expect } from 'vitest';
import { ensurePlaywrightIsolation, getIsolatedPlaywrightMcpConfig } from '../../src/lib/claude-mcp.js';

describe('ensurePlaywrightIsolation', () => {
  it('adds --isolated when Playwright args are missing', () => {
    const config = {
      mcpServers: {
        playwright: {
          command: 'npx',
        },
      },
    };

    const changed = ensurePlaywrightIsolation(config);

    expect(changed).toBe(true);
    expect(config.mcpServers.playwright.args).toEqual(['--isolated']);
  });

  it('does not duplicate --isolated when already present', () => {
    const config = {
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['--isolated'],
        },
      },
    };

    const changed = ensurePlaywrightIsolation(config);

    expect(changed).toBe(false);
    expect(config.mcpServers.playwright.args).toEqual(['--isolated']);
  });

  it('returns false when Playwright MCP is absent', () => {
    const config = { mcpServers: {} };
    expect(ensurePlaywrightIsolation(config)).toBe(false);
  });
});

describe('getIsolatedPlaywrightMcpConfig', () => {
  it('returns an isolated Playwright-only MCP config', () => {
    const config = {
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['@playwright/mcp'],
        },
        tldr: {
          command: 'tldr-mcp',
        },
      },
    };

    const result = getIsolatedPlaywrightMcpConfig(config);

    expect(result).toEqual({
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['@playwright/mcp', '--isolated'],
        },
      },
    });

    expect(config.mcpServers.playwright.args).toEqual(['@playwright/mcp']);
  });

  it('returns null when Playwright MCP is absent', () => {
    expect(getIsolatedPlaywrightMcpConfig({ mcpServers: {} })).toBeNull();
  });
});
