// Directory client view (PAN-2356): the `GET /api/directory` response the dashboard, the Settings
// directory panel and `pan machines directory` share. The wire protocol to the directory itself is in
// connect.ts, which stays runtime-import-free for the connect Worker.

import { Schema } from "effect"
import { AdvertisedEndpoint } from "./machines"

export const DirectoryClientState = Schema.Literals(["off", "connecting", "online", "refused"])
export type DirectoryClientState = typeof DirectoryClientState.Type

export const DirectoryPlan = Schema.Literals(["free", "tester"])
export type DirectoryPlan = typeof DirectoryPlan.Type

/** One machine of the account, as the directory lists it. */
export const DirectoryMachineView = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  publicKeyHex: Schema.String,
  fingerprint: Schema.String,
  online: Schema.Boolean,
  /** ISO-8601 UTC. */
  lastSeenAt: Schema.String,
  serverVersion: Schema.String,
  endpoints: Schema.Array(AdvertisedEndpoint),
  /** This machine holds a link to it. */
  linked: Schema.Boolean,
})
export type DirectoryMachineView = typeof DirectoryMachineView.Type

/**
 * Approver side: `pending` (request arrived), `open` (approval channel open, SAS known),
 * `approving` (this operator approved; waiting for the other machine to accept), `failed`.
 */
export const DirectoryApprovalState = Schema.Literals(["pending", "open", "approving", "failed"])
export type DirectoryApprovalState = typeof DirectoryApprovalState.Type

/** Requester side: `waiting` (no approver yet), `open` (SAS known), `accepted`, `rejected`. */
export const DirectoryJoinState = Schema.Literals(["waiting", "open", "accepted", "rejected"])
export type DirectoryJoinState = typeof DirectoryJoinState.Type

/** An incoming approval request: another machine asks to link with this one. */
export const DirectoryApprovalView = Schema.Struct({
  requestId: Schema.String,
  /** Environment id of the requesting machine. */
  from: Schema.String,
  label: Schema.String,
  fingerprint: Schema.String,
  /** Unix milliseconds. */
  expiresAt: Schema.Number,
  /** Six-digit code, set once the approval channel is open. */
  sas: Schema.NullOr(Schema.String),
  state: DirectoryApprovalState,
  /** Why the approval failed, when `state` is `failed`. */
  error: Schema.NullOr(Schema.String),
})
export type DirectoryApprovalView = typeof DirectoryApprovalView.Type

/** An outgoing join request this machine made. */
export const DirectoryJoinView = Schema.Struct({
  requestId: Schema.String,
  /** Target environment id, or null for every machine of the account. */
  to: Schema.NullOr(Schema.String),
  /** Unix milliseconds. */
  expiresAt: Schema.Number,
  /** Six-digit code, set once an approver opened the approval channel. */
  sas: Schema.NullOr(Schema.String),
  /** The approver's fingerprint, from the handshake key (never from the directory). */
  fingerprint: Schema.NullOr(Schema.String),
  state: DirectoryJoinState,
})
export type DirectoryJoinView = typeof DirectoryJoinView.Type

export const RelayStatusView = Schema.Struct({
  /** UTC calendar month, `YYYY-MM`. */
  month: Schema.String,
  bytesUsed: Schema.Number,
  capBytes: Schema.Number,
  stopped: Schema.Boolean,
})
export type RelayStatusView = typeof RelayStatusView.Type

export const DirectoryResponse = Schema.Struct({
  signedIn: Schema.Boolean,
  state: DirectoryClientState,
  /** The configured directory URL, or null when it is invalid. */
  url: Schema.NullOr(Schema.String),
  plan: Schema.NullOr(DirectoryPlan),
  refusal: Schema.NullOr(Schema.String),
  machines: Schema.Array(DirectoryMachineView),
  approvals: Schema.Array(DirectoryApprovalView),
  joins: Schema.Array(DirectoryJoinView),
  relay: Schema.NullOr(RelayStatusView),
})
export type DirectoryResponse = typeof DirectoryResponse.Type
