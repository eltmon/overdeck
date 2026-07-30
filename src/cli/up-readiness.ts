import { Effect } from 'effect';

/**
 * Wait for the dashboard to be healthy, then — when Traefik is enabled — wait for
 * the Traefik-routed URL to return 200. Returns the URL that should be announced
 * and opened. Falls back to the direct localhost API port when Traefik is not
 * ready within the bounded timeout.
 */
export async function resolveDashboardReadyUrl(config: {
  traefikEnabled: boolean;
  traefikDomain: string;
  dashboardPort: number;
  dashboardApiPort: number;
  healthTimeoutMs?: number;
  traefikTimeoutMs?: number;
  expectedIdentity?: { repoRoot: string; mode: 'primary' | 'peer' };
  expectedPid?: number;
}): Promise<{ readyUrl: string; apiUrl: string; traefikReady: boolean }> {
  const { waitForDashboardHealth, waitForTraefikHealth } = await import('../lib/platform-lifecycle.js');
  await Effect.runPromise(
    waitForDashboardHealth(config.dashboardApiPort, {
      timeoutMs: config.healthTimeoutMs ?? 15_000,
      expectedIdentity: config.expectedIdentity,
      expectedPid: config.expectedPid,
    }),
  );
  if (config.traefikEnabled) {
    const traefikReady = await Effect.runPromise(
      waitForTraefikHealth(config.traefikDomain, { timeoutMs: config.traefikTimeoutMs ?? 10_000 }),
    );
    if (traefikReady) {
      return {
        readyUrl: `https://${config.traefikDomain}`,
        apiUrl: `https://${config.traefikDomain}/api`,
        traefikReady: true,
      };
    }
    const readyUrl = `http://localhost:${config.dashboardApiPort}`;
    return { readyUrl, apiUrl: readyUrl, traefikReady: false };
  }
  return {
    readyUrl: `http://localhost:${config.dashboardPort}`,
    apiUrl: `http://localhost:${config.dashboardApiPort}`,
    traefikReady: false,
  };
}
