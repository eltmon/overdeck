/**
 * Anywhere boot (PAN-4645 WI-18, D-4645-21, NFR-7).
 *
 * On every dashboard: make sure the machine key exists and keep the link-store
 * snapshot fresh (a peer dashboard sharing this home then computes the same
 * `require_token_mint` as the primary). On the primary only: start the link
 * supervisor and wire it into the routes (status, reconnect, unlink
 * notification) and into the link client, then the SSH forward supervisor
 * (PAN-4404), which keeps one port forward per SSH machine. `main.ts` calls
 * `startAnywhere` once after the dashboard listens; `stopAnywhere` closes every
 * channel and forward.
 */
import { defaultDiscoverDeps, EndpointAdvertiser, setAdvertisedEndpointsSource } from '../../../lib/anywhere/endpoints.js';
import { setLinkRouteSource, linkFetch, closeLinkAgent } from '../../../lib/anywhere/link-client.js';
import { MACHINE_LINKS_REFRESH_MS, startLinkStoreRefresh, stopLinkStoreRefresh } from '../../../lib/anywhere/link-store.js';
import { ensureMachineKey } from '../../../lib/anywhere/machine-key.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { setLinkStatusSource, setPeerUnlinkNotifier } from '../routes/machines.js';
import { getOverdeckVersion } from '../routes/misc/shared.js';
import { setHeartbeatEndpointsHashSource } from './link-heartbeat.js';
import { defaultLinkSupervisorDeps, LinkSupervisor } from './link-supervisor.js';
import { defaultSshForwardSupervisorDeps, SshForwardSupervisor } from './ssh-forward-supervisor.js';
import { setSshForwardSupervisor } from './ssh-machine-service.js';

let supervisor: LinkSupervisor | null = null;
let sshForwards: SshForwardSupervisor | null = null;
let advertiser: EndpointAdvertiser | null = null;
let reconcileTimer: NodeJS.Timeout | null = null;

/** The port this dashboard listens on, by the same rule as ServerConfig. */
function dashboardPort(): number {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return Number.isNaN(port) ? 3011 : port;
}

export function currentLinkSupervisor(): LinkSupervisor | null {
  return supervisor;
}

export async function startAnywhere(options: { primary: boolean }): Promise<void> {
  await ensureMachineKey();
  startLinkStoreRefresh();
  if (!options.primary || supervisor) return;

  // WI-19: advertise this machine's endpoints (descriptor + heartbeat hash); refreshed every 10 min.
  const { environmentId } = await ensureEnvironmentIdentity();
  advertiser = new EndpointAdvertiser(defaultDiscoverDeps(dashboardPort(), environmentId));
  setAdvertisedEndpointsSource(() => advertiser?.current() ?? []);
  setHeartbeatEndpointsHashSource(() => advertiser?.hash() ?? '');
  await advertiser.start();

  supervisor = new LinkSupervisor(defaultLinkSupervisorDeps(await getOverdeckVersion()));
  supervisor.start();
  setLinkStatusSource(supervisor);
  setLinkRouteSource(supervisor);
  setPeerUnlinkNotifier(async (link) => {
    try {
      const response = await linkFetch(link.environmentId, '/api/machines/self', { method: 'DELETE', actor: 'operator' });
      return response.status === 200;
    } finally {
      closeLinkAgent(link.environmentId);
    }
  });
  // Links created or removed by the routes (or another process) are picked up
  // on the same cadence as the store snapshot.
  reconcileTimer = setInterval(() => supervisor?.reconcile(), MACHINE_LINKS_REFRESH_MS);
  reconcileTimer.unref?.();

  sshForwards = new SshForwardSupervisor(defaultSshForwardSupervisorDeps((linkId, routes) => supervisor?.updateRoutes(linkId, routes)));
  setSshForwardSupervisor(sshForwards);
  await sshForwards.start().catch((error: Error) => console.warn(`[ssh-machines] could not start SSH forwards: ${error.message}`));
}

export function stopAnywhere(): void {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  sshForwards?.stop();
  sshForwards = null;
  setSshForwardSupervisor(null);
  supervisor?.stop();
  supervisor = null;
  advertiser?.stop();
  advertiser = null;
  setAdvertisedEndpointsSource(null);
  setHeartbeatEndpointsHashSource(null);
  setLinkStatusSource(null);
  setLinkRouteSource(null);
  setPeerUnlinkNotifier(null);
  stopLinkStoreRefresh();
}
