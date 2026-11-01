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
