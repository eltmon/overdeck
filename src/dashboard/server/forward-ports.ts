/**
 * Which local TCP ports a linked machine may forward (PAN-4650 D-4650-16,
 * pan-2350 D-22).
 *
 * A forward reaches `127.0.0.1:<port>` on this machine for a dev-server
 * preview. Overdeck's own ports are never forwardable: the dashboard and its
 * API, the supervisor, Traefik's 80/443 and its dashboard port, and the port
 * this server listens on. Privileged ports (below 1024) and anything outside
 * the TCP range are refused too.
 */
import { loadConfig } from '../../lib/config.js';
import { readPlatformConfig } from '../../lib/platform-lifecycle.js';
import { getSupervisorPort } from '../../lib/supervisor.js';

export const MIN_FORWARD_PORT = 1024;
export const MAX_FORWARD_PORT = 65535;

/** The Overdeck ports a forward never reaches, read when a forward is asked for. */
export async function refusedForwardPorts(): Promise<Set<number>> {
  const platform = readPlatformConfig();
  const traefikDashboard = (await loadConfig()).traefik?.dashboard_port ?? 8080;
  const listening = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '', 10);
  const ports = [platform.dashboardPort, platform.dashboardApiPort, getSupervisorPort(), 80, 443, traefikDashboard];
  if (!Number.isNaN(listening)) ports.push(listening);
  return new Set(ports);
}

/** Pure: true when `port` is a whole TCP port at or above 1024 and not one of Overdeck's. */
export function isForwardablePort(port: number, refused: ReadonlySet<number>): boolean {
  return Number.isInteger(port) && port >= MIN_FORWARD_PORT && port <= MAX_FORWARD_PORT && !refused.has(port);
}
