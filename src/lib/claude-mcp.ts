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
