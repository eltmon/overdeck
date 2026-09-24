import { describe, it, expect } from 'vitest';
import { ensurePlaywrightIsolation, ensureExcalidrawMcp, getIsolatedPlaywrightMcpConfig } from '../../src/lib/claude-mcp.js';

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

describe('ensureExcalidrawMcp', () => {
  it('injects the off-the-shelf excalidraw-mcp default when the entry is missing', () => {
    const config: { mcpServers: Record<string, any> } = { mcpServers: {} };

    const changed = ensureExcalidrawMcp(config);

    expect(changed).toBe(true);
    expect(config.mcpServers.excalidraw).toEqual({
      command: 'npx',
      args: ['-y', 'excalidraw-mcp'],
      env: {
        EXPRESS_SERVER_URL: 'http://localhost:3000',
        ENABLE_CANVAS_SYNC: 'true',
      },
    });
  });

  it('creates mcpServers if absent entirely', () => {
    const config: Record<string, any> = {};

    const changed = ensureExcalidrawMcp(config);

    expect(changed).toBe(true);
    expect(config.mcpServers.excalidraw.command).toBe('npx');
  });

  it('leaves a user-customized excalidraw entry alone', () => {
    const config = {
      mcpServers: {
        excalidraw: {
          command: 'node',
          args: ['/home/me/Projects/mcp_excalidraw/dist/index.js'],
          env: { EXPRESS_SERVER_URL: 'http://localhost:4242' },
        },
      },
    };

    const changed = ensureExcalidrawMcp(config);

    expect(changed).toBe(false);
    expect(config.mcpServers.excalidraw.command).toBe('node');
    expect(config.mcpServers.excalidraw.env.EXPRESS_SERVER_URL).toBe('http://localhost:4242');
  });

  it('repairs an entry that was blanked out (no command)', () => {
    const config: { mcpServers: Record<string, any> } = {
      mcpServers: { excalidraw: { args: [] } },
    };

    const changed = ensureExcalidrawMcp(config);

    expect(changed).toBe(true);
    expect(config.mcpServers.excalidraw.command).toBe('npx');
  });
});
