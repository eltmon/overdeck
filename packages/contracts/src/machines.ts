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

/**
 * Where a route on a link came from. `directory` routes (PAN-2356) are dynamic: offered while the
 * overdeck.ai directory lists the peer, never stored in machine-links.json.
 */
export const RouteSource = Schema.Literals(["pairing", "manual", "advertised", "directory"])
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

/** PAN-4651 D-4651-8: a machine's load, sampled every 15 s and carried in the link heartbeat. */
export const LoadSample = Schema.Struct({
  /** CPU PSI `some avg10` (percent); null off Linux. */
  cpuPsiSomeAvg10: Schema.NullOr(Schema.Number),
  cpuSaturated: Schema.Boolean,
  memAvailableBytes: Schema.NullOr(Schema.Number),
  workingAgents: Schema.Number,
  sampledAt: Schema.String,
})
export type LoadSample = typeof LoadSample.Type

/** PAN-4651 FR-7: `on-request` reserves a machine — Auto skips it unless only it has a needed tag. */
export const MachinePlacementMode = Schema.Literals(["auto", "on-request"])
export type MachinePlacementMode = typeof MachinePlacementMode.Type

/** PAN-4651 FR-6: `CPU 3% · 41 GB · 2 agents` (unknown parts `n/a`); null without a sample. */
export function formatMachineLoad(load: LoadSample | null | undefined): string | null {
  if (!load) return null
  const cpu = load.cpuPsiSomeAvg10 === null ? "n/a" : `${Math.round(load.cpuPsiSomeAvg10)}%`
  const memory = load.memAvailableBytes === null ? "n/a" : `${Math.floor(load.memAvailableBytes / 2 ** 30)}`
  return `CPU ${cpu} · ${memory} GB · ${load.workingAgents} ${load.workingAgents === 1 ? "agent" : "agents"}`
}

/** PAN-4651 FR-7: `tags: docker, linux · reserved`; null when there is neither. */
export function formatMachineProfile(tags: readonly string[] | undefined, placement: MachinePlacementMode | undefined): string | null {
  const parts = [...(tags && tags.length > 0 ? [`tags: ${tags.join(", ")}`] : []), ...(placement === "on-request" ? ["reserved"] : [])]
  return parts.length > 0 ? parts.join(" · ") : null
}

/** PAN-4651 D-4651-9: why Auto placement skipped one machine. */
export const PlacementRejection = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  /** `offline`, `unsupported`, `no project`, `no <tag>`, `CPU saturated` or `reserved`. */
  reason: Schema.String,
})
export type PlacementRejection = typeof PlacementRejection.Type

/** PAN-4651 D-4651-9: the machine Auto chose (with the one-line reason), or why none fits. */
export const PlacementAnswer = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    environmentId: Schema.String,
    label: Schema.String,
    self: Schema.Boolean,
    reason: Schema.String,
    rejections: Schema.Array(PlacementRejection),
  }),
  Schema.Struct({ ok: Schema.Literal(false), rejections: Schema.Array(PlacementRejection) }),
])
export type PlacementAnswer = typeof PlacementAnswer.Type

/** PAN-4651 D-4651-11: one project a machine has registered, as linked machines see it (never a path). */
export const MachineProject = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  /** `github.com/<owner>/<repo>` or `gitlab.com/<path>`; null when the project has no remote repo. */
  gitOrigin: Schema.NullOr(Schema.String),
})
export type MachineProject = typeof MachineProject.Type

/** PAN-4651 D-4651-13: one repository across machines, as `GET /api/fleet/projects` lists it. */
export const FleetProjectRow = Schema.Struct({
  /** The git origin slug; null for a local project without one (its own row). */
  gitOrigin: Schema.NullOr(Schema.String),
  name: Schema.String,
  /** This machine's project for the slug, or null when only other machines have it. */
  local: Schema.NullOr(Schema.Struct({ key: Schema.String })),
  machines: Schema.Array(Schema.Struct({ environmentId: Schema.String, label: Schema.String, key: Schema.String, state: LinkState })),
})
export type FleetProjectRow = typeof FleetProjectRow.Type

export const FleetProjectsResponse = Schema.Struct({ combine: Schema.Boolean, projects: Schema.Array(FleetProjectRow) })
export type FleetProjectsResponse = typeof FleetProjectsResponse.Type

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
  /** PAN-4650: Hide this machine — its conversations are left out of the conversation list. */
  hidden: Schema.optional(Schema.Boolean),
  /** Present only on links this server set up over SSH. */
  ssh: Schema.optional(SshLinkInfo),
  /** PAN-4651: the peer's last heartbeat load sample; null before one arrives or from a peer that predates it. */
  load: Schema.optional(Schema.NullOr(LoadSample)),
  /** PAN-4651: the peer's capability tags (detected plus `anywhere.machine.tags`). */
  tags: Schema.optional(Schema.Array(Schema.String)),
  placement: Schema.optional(MachinePlacementMode),
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
    /** PAN-4650 D-4: linked machines list this machine's conversations (anywhere.json, default on). */
    shareConversations: Schema.Boolean,
    /** PAN-4651 D-4651-13: one project per git origin across machines (anywhere.json, default on). */
    combineRepositories: Schema.optional(Schema.Boolean),
    /** PAN-4651: this machine's own load sample, tags and placement mode. */
    load: Schema.optional(Schema.NullOr(LoadSample)),
    tags: Schema.optional(Schema.Array(Schema.String)),
    placement: Schema.optional(MachinePlacementMode),
    /** PAN-4905: config.toml `[remote] enabled`; the Add a Fly machine dialog reads it before the click. */
    remoteEnabled: Schema.optional(Schema.Boolean),
    /** PAN-4905: config.toml as a display path (`~/.overdeck/config.toml`). */
    remoteConfigFile: Schema.optional(Schema.String),
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
