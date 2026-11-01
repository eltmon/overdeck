// Machine links (PAN-4645, Anywhere W-LINK1 / W-LINK2 / W-LINK3).
//
// Shared shapes for the link protocol version, route kinds, the endpoints a
// machine advertises in its environment descriptor, and the `GET /api/machines`
// response. Views never carry a token or a token hash: they are the public face
// of a link or of a `machine` access token.

import { Schema } from "effect"

/**
 * Secure-channel link protocol version (D-4645-11). Independent of
 * `ENVIRONMENT_PROTOCOL_VERSION`: a peer whose descriptor reports another value,
 * or no `capabilities.machineLinks`, is `unsupported`.
 */
export const LINK_PROTOCOL_VERSION = 1

/** The exact command that installs one Overdeck version (PAN-4654 FR-1, D-2). */
export function overdeckInstallCommand(version: string): string {
  return `npm install -g @overdeck/core@${version}`
}

/** Route kinds, ranked best to worst (D-10 of the Anywhere PRD). */
export const ROUTE_KINDS = ["lan", "tailnet", "ssh", "public", "direct", "relay"] as const
export const RouteKind = Schema.Literals(ROUTE_KINDS)
export type RouteKind = typeof RouteKind.Type

/** Where a route on a link came from. */
export const RouteSource = Schema.Literals(["pairing", "manual", "advertised"])
export type RouteSource = typeof RouteSource.Type

/** An endpoint a machine advertises in its descriptor (`lan` and `tailnet` only in this issue). */
export const AdvertisedEndpoint = Schema.Struct({
  kind: Schema.Literals(["lan", "tailnet"]),
  /** `tcp://host:port` or `wss://host[:port]/ws/link`. */
  url: Schema.String,
})
export type AdvertisedEndpoint = typeof AdvertisedEndpoint.Type

/** Link supervisor state (FR-3). */
export const LinkState = Schema.Literals(["online", "connecting", "offline", "unsupported", "revoked"])
export type LinkState = typeof LinkState.Type

/** Access level of a link (FR-4). */
export const LinkAccess = Schema.Literals(["operator", "agent-fenced"])
export type LinkAccess = typeof LinkAccess.Type

/** Last known result of probing one route. */
export const LinkRouteStatus = Schema.Literals(["untried", "current", "reachable", "unreachable"])
export type LinkRouteStatus = typeof LinkRouteStatus.Type

export const LinkRouteView = Schema.Struct({
  url: Schema.String,
  kind: RouteKind,
  source: RouteSource,
  status: LinkRouteStatus,
})
export type LinkRouteView = typeof LinkRouteView.Type

/** A heartbeat gap, diagnosed as a peer freeze or a network failure (FR-9). */
export const LinkIncident = Schema.Struct({
  kind: Schema.Literals(["froze", "network"]),
  durationMs: Schema.Number,
  /** ISO-8601 UTC time the gap ended, in the linking machine's clock. */
  at: Schema.String,
})
export type LinkIncident = typeof LinkIncident.Type

/** Whether the linking server started the SSH host's Overdeck or adopted one already running (PAN-4404). */
export const SshLaunch = Schema.Literals(["managed", "external"])
export type SshLaunch = typeof SshLaunch.Type

/** State of the local SSH port forward that carries an SSH machine's link (PAN-4404 D-4404-10). */
export const SshForwardState = Schema.Literals(["starting", "up", "down", "attention"])
export type SshForwardState = typeof SshForwardState.Type

/** The SSH side of a link that this server set up over SSH. */
export const SshLinkInfo = Schema.Struct({
  destination: Schema.String,
  launch: SshLaunch,
  forward: SshForwardState,
  forwardDetail: Schema.NullOr(Schema.String),
  localPort: Schema.Number,
  remotePort: Schema.Number,
})
export type SshLinkInfo = typeof SshLinkInfo.Type

/** One outbound link as shown by `GET /api/machines` and `pan machines list`. */
export const MachineLinkView = Schema.Struct({
  id: Schema.String,
  environmentId: Schema.String,
  label: Schema.String,
  /** Fingerprint of the pinned machine key: five dash-separated groups of four hex. */
  fingerprint: Schema.String,
  access: LinkAccess,
  state: LinkState,
  stateDetail: Schema.NullOr(Schema.String),
  currentRoute: Schema.NullOr(Schema.String),
  routes: Schema.Array(LinkRouteView),
  lastHeartbeatAt: Schema.NullOr(Schema.String),
  incident: Schema.NullOr(LinkIncident),
  peerVersion: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  /** Present only on links this server set up over SSH. */
  ssh: Schema.optional(SshLinkInfo),
})
export type MachineLinkView = typeof MachineLinkView.Type

/** One `machine` token this machine issued to another machine (inbound access). */
export const InboundMachineView = Schema.Struct({
  tokenId: Schema.String,
  environmentId: Schema.String,
  label: Schema.String,
  fingerprint: Schema.String,
  access: LinkAccess,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
})
export type InboundMachineView = typeof InboundMachineView.Type

export const MachinesResponse = Schema.Struct({
  self: Schema.Struct({
    environmentId: Schema.String,
    label: Schema.String,
    fingerprint: Schema.String,
  }),
  links: Schema.Array(MachineLinkView),
  inbound: Schema.Array(InboundMachineView),
})
export type MachinesResponse = typeof MachinesResponse.Type

/**
 * Version of the `OVERDECK_SSH_HELPER` result line that `pan machines ssh-helper`
 * prints on the SSH host (PAN-4404).
 */
export const SSH_HELPER_PROTOCOL = 1

/** Error codes of the SSH machine flow (PAN-4404 D-4404-9). */
export const SSH_MACHINE_ERROR_CODES = [
  "bad-destination",
  "busy",
  "unresolvable",
  "unreachable",
  "host-key",
  "auth-failed",
  "pan-missing",
  "version-mismatch",
  "helper-failed",
  "start-failed",
  "forward-failed",
  "self-link",
  "not-found",
] as const
export const SshMachineErrorCode = Schema.Literals(SSH_MACHINE_ERROR_CODES)
export type SshMachineErrorCode = typeof SshMachineErrorCode.Type

/** Answer of `POST /api/machines/ssh/test` and `pan machines test-ssh`. */
export const SshTestResult = Schema.Struct({
  reachable: Schema.Boolean,
  panVersion: Schema.NullOr(Schema.String),
  localVersion: Schema.String,
  versionMatches: Schema.Boolean,
  error: Schema.NullOr(SshMachineErrorCode),
  message: Schema.NullOr(Schema.String),
})
export type SshTestResult = typeof SshTestResult.Type
