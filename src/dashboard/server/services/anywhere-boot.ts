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
import { readAccount } from '../../../lib/account/store.js';
import { readDirectoryUrl } from '../../../lib/anywhere/directory-config.js';
import { defaultDiscoverDeps, EndpointAdvertiser, setAdvertisedEndpointsSource } from '../../../lib/anywhere/endpoints.js';
import { setLinkRouteSource, linkFetch, closeLinkAgent } from '../../../lib/anywhere/link-client.js';
import { linksSnapshot, MACHINE_LINKS_REFRESH_MS, startLinkStoreRefresh, stopLinkStoreRefresh } from '../../../lib/anywhere/link-store.js';
import { currentMachineProfile, startMachineCapabilities, stopMachineCapabilities } from '../../../lib/anywhere/machine-capabilities.js';
import { ensureMachineKey } from '../../../lib/anywhere/machine-key.js';
import { machineProjectsHashForHeartbeat } from '../../../lib/anywhere/project-origin.js';
import { sharedConversationsHashForHeartbeat } from '../../../lib/anywhere/shared-conversations.js';
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
import { setHeartbeatConversationsHashSource, setHeartbeatEndpointsHashSource, setHeartbeatMachineFactsSource } from './link-heartbeat.js';
import { startTransferSweep } from './conversation-release-service.js';
import { defaultLinkSupervisorDeps, LinkSupervisor } from './link-supervisor.js';
import { setLinkPresenceSource } from './conversation-list-merged.js';
import { createLinkedConversationsSync, setLinkedConversationsSync } from './linked-conversations-sync.js';
import { createLinkedProjectsSync, setLinkedProjectsSync } from './linked-projects-sync.js';
import { createLinkedNeedsYouSync, setLinkedNeedsYouSync } from './linked-needs-you-sync.js';
import { needsYouHashForHeartbeat } from './needs-you-feed.js';
import { currentMachineLoad, startMachineLoadSampler, stopMachineLoadSampler } from './machine-load.js';
import { defaultRemoteLaneFollowerDeps, RemoteLaneFollower, setRemoteLaneFollower } from './remote-lane-follower.js';
import { defaultRemoteWorkerFollowerDeps, RemoteWorkerFollower, setRemoteWorkerFollower } from './remote-worker-follower.js';
import { stopForwardsWithoutLink } from './port-forwards.js';
import { defaultSshForwardSupervisorDeps, SshForwardSupervisor } from './ssh-forward-supervisor.js';
import { setSshForwardSupervisor } from './ssh-machine-service.js';

let supervisor: LinkSupervisor | null = null;
let sshForwards: SshForwardSupervisor | null = null;
let advertiser: EndpointAdvertiser | null = null;
let directory: DirectoryClient | null = null;
let approvals: DirectoryApprovalService | null = null;
let relay: RelayClient | null = null;
let inbox: InboxClient | null = null;
let reconcileTimer: NodeJS.Timeout | null = null;
let stopTransferSweep: (() => void) | null = null;
let workerFollower: RemoteWorkerFollower | null = null;
let laneFollower: RemoteLaneFollower | null = null;

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
  setHeartbeatConversationsHashSource(sharedConversationsHashForHeartbeat);
  // PAN-4651 D-4651-8: load every 15 s, capability tags every 10 min; the heartbeat reads the last values.
  startMachineLoadSampler();
  startMachineCapabilities();
  setHeartbeatMachineFactsSource(() => {
    const load = currentMachineLoad();
    const profile = currentMachineProfile();
    const projectsHash = machineProjectsHashForHeartbeat();
    const needsYouHash = needsYouHashForHeartbeat();
    return {
      ...(load ? { load } : {}),
      ...(profile ? { tags: profile.tags, placement: profile.placement } : {}),
      ...(projectsHash ? { projectsHash } : {}),
      ...(needsYouHash ? { needsYouHash } : {}),
    };
  });
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

  // PAN-4650 WI-3: linked machines' conversation lists, fetched on connect and on a changed hash.
  const linkedConversations = createLinkedConversationsSync();
  setLinkedConversationsSync(linkedConversations);
  // PAN-4651 WI-3: linked machines' project lists, same trigger rule (connect + changed hash).
  const linkedProjects = createLinkedProjectsSync();
  setLinkedProjectsSync(linkedProjects);
  // PAN-4651 WI-20: linked machines' Needs-You feeds, same trigger rule.
  const linkedNeedsYou = createLinkedNeedsYouSync();
  setLinkedNeedsYouSync(linkedNeedsYou);
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
    onDescriptor: (link) => Promise.all([linkedConversations, linkedProjects, linkedNeedsYou].map((sync) => sync.onConnect(link))).then(() => undefined),
    onHeartbeat: (link, payload) => Promise.all([linkedConversations, linkedProjects, linkedNeedsYou].map((sync) => sync.onHeartbeat(link, payload))).then(() => undefined),
  });
  supervisor.start();
  // PAN-4651 WI-12: follow workers delegated to linked machines; resumes running stand-ins from disk.
  const linkSupervisor = supervisor;
  const linkOnline = (environmentId: string): boolean => linkSupervisor.routeFor(environmentId)?.state === 'online';
  workerFollower = new RemoteWorkerFollower(defaultRemoteWorkerFollowerDeps(linkOnline));
  setRemoteWorkerFollower(workerFollower);
  await workerFollower.start().catch((error: Error) => console.warn(`[anywhere] could not resume remote workers: ${error.message}`));
  // PAN-4638 WI-7: follow gauntlet lanes running on linked machines; resumes stand-ins from disk.
  laneFollower = new RemoteLaneFollower(defaultRemoteLaneFollowerDeps(linkOnline));
  setRemoteLaneFollower(laneFollower);
  await laneFollower.start().catch((error: Error) => console.warn(`[anywhere] could not resume remote lanes: ${error.message}`));
  setLinkStatusSource(supervisor);
  setLinkPresenceSource(supervisor);
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
  reconcileTimer = setInterval(() => {
    supervisor?.reconcile();
    const active = linksSnapshot().filter((link) => link.revokedAt === null).map((link) => link.environmentId);
    linkedConversations.prune(active);
    linkedProjects.prune(active);
    linkedNeedsYou.prune(active);
    // PAN-4650 WI-18: a forward closes when its link goes away.
    stopForwardsWithoutLink(active);
  }, MACHINE_LINKS_REFRESH_MS);
  reconcileTimer.unref?.();
  // PAN-4650 WI-9: Pull here transfer directories live at most 15 minutes.
  stopTransferSweep = startTransferSweep();

  sshForwards = new SshForwardSupervisor(defaultSshForwardSupervisorDeps((linkId, routes) => supervisor?.updateRoutes(linkId, routes)));
  setSshForwardSupervisor(sshForwards);
  await sshForwards.start().catch((error: Error) => console.warn(`[ssh-machines] could not start SSH forwards: ${error.message}`));
}

export function stopAnywhere(): void {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  stopTransferSweep?.();
  stopTransferSweep = null;
  sshForwards?.stop();
  sshForwards = null;
  setSshForwardSupervisor(null);
  setLinkPresenceSource(null);
  workerFollower?.stop();
  workerFollower = null;
  setRemoteWorkerFollower(null);
  laneFollower?.stop();
  laneFollower = null;
  setRemoteLaneFollower(null);
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
  setHeartbeatConversationsHashSource(null);
  setHeartbeatMachineFactsSource(null);
  setLinkedProjectsSync(null);
  setLinkedNeedsYouSync(null);
  setLinkedConversationsSync(null);
  stopMachineLoadSampler();
  stopMachineCapabilities();
  setLinkStatusSource(null);
  setLinkRouteSource(null);
  setPeerUnlinkNotifier(null);
  stopLinkStoreRefresh();
}
