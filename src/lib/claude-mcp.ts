export function ensurePlaywrightIsolation(mcpConfig: Record<string, any>): boolean {
  const playwright = mcpConfig?.mcpServers?.playwright;
  if (!playwright || typeof playwright !== 'object') {
    return false;
  }

  if (!Array.isArray(playwright.args)) {
    playwright.args = [];
  }

  if (playwright.args.includes('--isolated')) {
    return false;
  }

  playwright.args.push('--isolated');
  return true;
}

/**
 * Off-the-shelf Excalidraw MCP server (npm package: excalidraw-mcp).
 * Provisioned by `pan sync` so every Panopticon user gets the `/excalidraw`
 * skill's MCP backend without manual `claude mcp add` steps. The canvas
 * server URL defaults to localhost:3000 (the upstream convention) and can
 * be overridden per-machine by setting EXPRESS_SERVER_URL in the user's
 * environment before invoking the MCP — the env block here is the default
 * that ships, not a hard pin.
 */
const EXCALIDRAW_MCP_DEFAULT: { command: string; args: string[]; env: Record<string, string> } = {
  command: 'npx',
  args: ['-y', 'excalidraw-mcp'],
  env: {
    EXPRESS_SERVER_URL: 'http://localhost:3000',
    ENABLE_CANVAS_SYNC: 'true',
  },
};

/**
 * Ensure the off-the-shelf Excalidraw MCP server is registered in the user's
 * mcp.json. Returns true when a change was made (entry was missing and the
 * default was injected), false when the entry was already present.
 *
 * The check is intentionally conservative: an existing entry is left alone
 * as long as it has a non-empty `command` string — users may have customized
 * it (local-path checkout, Docker image, custom env). We only inject the
 * default when the key is missing entirely or has been blanked out.
 */
export function ensureExcalidrawMcp(mcpConfig: Record<string, any>): boolean {
  if (!mcpConfig || typeof mcpConfig !== 'object') return false;
  if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
    mcpConfig.mcpServers = {};
  }
  const existing = mcpConfig.mcpServers.excalidraw;
  const looksConfigured =
    existing
    && typeof existing === 'object'
    && typeof existing.command === 'string'
    && existing.command.length > 0;
  if (looksConfigured) return false;

  mcpConfig.mcpServers.excalidraw = JSON.parse(JSON.stringify(EXCALIDRAW_MCP_DEFAULT));
  return true;
}

export function getIsolatedPlaywrightMcpConfig(
  mcpConfig: Record<string, any>
): Record<string, any> | null {
  const playwright = mcpConfig?.mcpServers?.playwright;
  if (!playwright || typeof playwright !== 'object') {
    return null;
  }

  const remoteConfig = {
    mcpServers: {
      playwright: JSON.parse(JSON.stringify(playwright)),
    },
  };

  ensurePlaywrightIsolation(remoteConfig);
  return remoteConfig;
}
