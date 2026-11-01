/**
 * Anywhere boot (PAN-4645 WI-18, D-4645-21, NFR-7).
 *
 * On every dashboard: make sure the machine key exists and keep the link-store
 * snapshot fresh (a peer dashboard sharing this home then computes the same
 * `require_token_mint` as the primary). On the primary only: start the link
 * supervisor and wire it into the routes (status, reconnect, unlink
 * notification) and into the link client. `main.ts` calls `startAnywhere` once
 * after the dashboard listens; `stopAnywhere` closes every channel.
 */
import { readAccount } from '../../../lib/account/store.js';
import { readDirectoryUrl } from '../../../lib/anywhere/directory-config.js';
import { defaultDiscoverDeps, EndpointAdvertiser, setAdvertisedEndpointsSource } from '../../../lib/anywhere/endpoints.js';
import { setLinkRouteSource, linkFetch, closeLinkAgent } from '../../../lib/anywhere/link-client.js';
import { linksSnapshot, MACHINE_LINKS_REFRESH_MS, startLinkStoreRefresh, stopLinkStoreRefresh } from '../../../lib/anywhere/link-store.js';
import { ensureMachineKey } from '../../../lib/anywhere/machine-key.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { setDirectoryStatusSource, setRelayStatusSource } from '../../../lib/remote-access/anywhere-status.js';
import { setLinkStatusSource, setPeerUnlinkNotifier } from '../routes/machines.js';
import { getOverdeckVersion } from '../routes/misc/shared.js';
import { defaultApprovalDeps, DirectoryApprovalService, setApprovalService } from './directory-approval.js';
import { DirectoryClient, defaultOpenSocket, setDirectoryClient } from './directory-client.js';
import { directoryRoutesFor } from './directory-routes.js';
import { startDirectoryRtc, stopDirectoryRtc } from './directory-rtc.js';
import { InboxDedupe } from '../../../lib/triggers/inbox.js';
import { triggerDeliveryDependencies } from '../routes/trigger-hooks.js';
import { InboxClient } from './inbox-client.js';
import { RelayClient, setRelayClient } from './relay-client.js';
import { setHeartbeatEndpointsHashSource } from './link-heartbeat.js';
import { defaultLinkSupervisorDeps, LinkSupervisor } from './link-supervisor.js';

let supervisor: LinkSupervisor | null = null;
let advertiser: EndpointAdvertiser | null = null;
let directory: DirectoryClient | null = null;
let approvals: DirectoryApprovalService | null = null;
let relay: RelayClient | null = null;
let inbox: InboxClient | null = null;
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

  // WI-9: the overdeck.ai directory socket; a signed-out machine opens none (FR-2356-2).
  const serverVersion = await getOverdeckVersion();
  directory = new DirectoryClient({
    readAccount,
    readDirectoryUrl,
    identity: ensureEnvironmentIdentity,
    machineKey: ensureMachineKey,
    endpoints: () => advertiser?.current() ?? [],
    endpointsHash: () => advertiser?.hash() ?? '',
    serverVersion,
    linkedEnvironmentIds: () => new Set(linksSnapshot().filter((l) => l.revokedAt === null).map((l) => l.environmentId)),
    openSocket: defaultOpenSocket,
    random: Math.random,
  });
  setDirectoryClient(directory);
  await directory.start();
  // WI-11: `rtc://` and `rtc+turn://` routes dial through the directory; incoming data channels
  // run the same secure-channel handshake as TCP.
  // WI-17: relay dials are refused once the plan or the month's allowance says so, and metered.
  relay = new RelayClient(directory);
  relay.start();
  setRelayClient(relay);
  startDirectoryRtc(directory, relay);
  // WI-18: the status card's directory and relay lines.
  setDirectoryStatusSource(() => {
    const status = directory?.status();
    if (!status?.signedIn) return null;
    return { state: status.state, plan: status.plan, url: status.url, refusal: status.refusal };
  });
  setRelayStatusSource(() => {
    // Only a plan with the relay (tester until billing) has relay lines; the plan is the last welcome's.
    const status = directory?.status();
    if (!status?.signedIn || status.plan !== 'tester') return null;
    const current = relay?.relayStatus();
    if (!current?.status) return null;
    return { using: current.using, bytesUsed: current.status.bytesUsed, capBytes: current.status.capBytes, stopped: current.status.stopped };
  });
  // WI-14: two-screen approvals; their views ride in GET /api/directory.
  approvals = new DirectoryApprovalService(defaultApprovalDeps(directory, () => advertiser?.current() ?? []));
  setApprovalService(approvals);
  // WI-19: deliver the webhook events the directory inbox held while this machine was away.
  inbox = new InboxClient(directory, { keyPair: ensureMachineKey, delivery: triggerDeliveryDependencies, dedupe: new InboxDedupe() });
  inbox.start();
  const approvalViews = approvals;
  directory.setApprovalViews(() => approvalViews.views());

  supervisor = new LinkSupervisor({
    ...defaultLinkSupervisorDeps(serverVersion),
    // WI-12: direct, relay and directory-reported routes, offered while the directory lists the peer.
    dynamicRoutes: (link) =>
      directoryRoutesFor(link, directory && {
        isOnline: () => directory?.isOnline() ?? false,
        machine: (environmentId) => directory?.machine(environmentId) ?? null,
        relayEntitled: () => relay?.relayEntitled() ?? false,
      }),
    relayEntitled: () => relay?.relayEntitled() ?? false,
  });
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
}

export function stopAnywhere(): void {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  supervisor?.stop();
  supervisor = null;
  inbox?.stop();
  inbox = null;
  approvals?.stop();
  approvals = null;
  setApprovalService(null);
  setDirectoryStatusSource(null);
  setRelayStatusSource(null);
  stopDirectoryRtc();
  relay?.stop();
  relay = null;
  setRelayClient(null);
  directory?.setApprovalViews(null);
  directory?.stop();
  directory = null;
  setDirectoryClient(null);
  advertiser?.stop();
  advertiser = null;
  setAdvertisedEndpointsSource(null);
  setHeartbeatEndpointsHashSource(null);
  setLinkStatusSource(null);
  setLinkRouteSource(null);
  setPeerUnlinkNotifier(null);
  stopLinkStoreRefresh();
}
