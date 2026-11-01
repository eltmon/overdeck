// Directory protocol (PAN-2356, Anywhere W-LINK5 / W-LINK8 / directory inbox): the frames a machine
// exchanges with its account's directory Durable Object at `wss://connect.overdeck.ai/v1/directory`,
// plus the constants and user-facing strings both sides share.
//
// Runtime-import-free (like sharing.ts): the connect Worker imports this file by relative path, so it
// may only `import type`. The dashboard's `GET /api/directory` view schemas live in connect-view.ts.
//
// All frames are JSON text frames. Besides them, the machine sends the text `ping` every 30 s and the
// directory answers `pong`; a socket with no `pong` for 75 s is closed and reconnected.

import type { IceServer, SignalData } from "./sharing"

export const CONNECT_PROTOCOL_VERSION = 1
export type ConnectProtocolVersion = typeof CONNECT_PROTOCOL_VERSION

/** Relay allowance per account per UTC calendar month (OD-3): 50 GB. */
export const RELAY_MONTHLY_CAP_BYTES = 50_000_000_000
/** Largest webhook body the directory inbox accepts (D-2356-14). */
export const INBOX_BODY_MAX_BYTES = 262_144
/** How long the inbox holds a sealed event before it expires (D-2356-18). */
export const INBOX_HOLD_MS = 86_400_000
/** How long an approval request stays live (D-2356-9). */
export const APPROVAL_TTL_MS = 600_000

export const FREE_MACHINE_LIMIT_MESSAGE = "The free account includes 3 machines"
export const NO_DIRECT_PATH_MESSAGE = "No direct path; install Tailscale or use the relay plan"
export const RELAY_CAP_MESSAGE = "Relay allowance used; install Tailscale or add 50 GB"

/** WebSocket close codes the directory uses. */
export const CONNECT_CLOSE_CODES = {
  unauthorized: 4001,
  grantExpired: 4003,
  machineLimit: 4009,
  unsupportedProtocol: 4010,
  /** Replaced by a newer socket for the same machine. */
  replaced: 4011,
  forgotten: 4012,
} as const
export type ConnectCloseCode = (typeof CONNECT_CLOSE_CODES)[keyof typeof CONNECT_CLOSE_CODES]

/** Account plan as the directory sees it (`Entitlement.plan` of the account service). */
export type ConnectPlan = "free" | "tester"

export type ConnectErrorCode =
  | "unauthorized" | "unsupported" | "machine_limit" | "peer_offline"
  | "approval_limit" | "approval_unknown" | "relay_not_allowed" | "relay_cap_reached"
  | "turn_unavailable" | "plan_required" | "bad_frame"

/** An endpoint a machine advertises; structurally `AdvertisedEndpoint` of machines.ts. */
export interface DirectoryEndpoint { readonly kind: "lan" | "tailnet"; readonly url: string }

/** What the directory knows about one of the account's machines. */
export interface DirectoryMachine {
  readonly environmentId: string
  readonly label: string
  /** X25519 machine public key, 64 lowercase hex. */
  readonly publicKeyHex: string
  /** Five dash-separated groups of four hex characters. */
  readonly fingerprint: string
  readonly online: boolean
  /** ISO-8601 UTC time the machine last had a directory socket open. */
  readonly lastSeenAt: string
  readonly serverVersion: string
  readonly endpoints: readonly DirectoryEndpoint[]
}

export interface RelayStatus {
  /** UTC calendar month, `YYYY-MM`. */
  readonly month: string
  readonly bytesUsed: number
  readonly capBytes: number
  readonly stopped: boolean
}

export type SignalPurpose = "link" | "approval"

/** Machine → directory. */
export type MachineToDirectoryFrame =
  | {
    readonly type: "hello"
    readonly protocol: ConnectProtocolVersion
    readonly environmentId: string
    /** At most 64 characters. */
    readonly label: string
    readonly publicKeyHex: string
    readonly serverVersion: string
    readonly linkProtocol: number
    /** At most 16. */
    readonly endpoints: readonly DirectoryEndpoint[]
  }
  | { readonly type: "endpoints"; readonly endpoints: readonly DirectoryEndpoint[] }
  | { readonly type: "forget"; readonly environmentId: string }
  /** `requestId` is 32 lowercase hex; `to: null` asks every other machine of the account. */
  | { readonly type: "approval-request"; readonly requestId: string; readonly to: string | null }
  | { readonly type: "approval-cancel"; readonly requestId: string }
  | {
    readonly type: "signal"
    readonly to: string
    /** 32 lowercase hex. */
    readonly session: string
    readonly purpose: SignalPurpose
    readonly relay: boolean
    readonly data: SignalData
  }
  | { readonly type: "ice-servers"; readonly requestId: string; readonly relay: boolean }
  /** Ciphertext bytes since the last report, integer, 0 ≤ bytes ≤ 1e9. */
  | { readonly type: "relay-usage"; readonly bytes: number }
  | { readonly type: "inbox-create"; readonly requestId: string }
  | { readonly type: "inbox-delete"; readonly inboxId: string }
  | { readonly type: "inbox-ack"; readonly eventId: string }
  /** `retryAfterSeconds` is 60–3600. */
  | { readonly type: "inbox-nack"; readonly eventId: string; readonly retryAfterSeconds: number }

/** Directory → machine. */
export type DirectoryToMachineFrame =
  | {
    readonly type: "welcome"
    readonly protocol: ConnectProtocolVersion
    readonly plan: ConnectPlan
    readonly maxMachines: number | null
    readonly relayAllowed: boolean
    readonly inboxAllowed: boolean
    readonly relay: RelayStatus
    readonly machines: readonly DirectoryMachine[]
  }
  /** Sent to every socket on any change. */
  | { readonly type: "directory"; readonly machines: readonly DirectoryMachine[] }
  | {
    readonly type: "approval-request"
    readonly requestId: string
    readonly from: string
    readonly label: string
    readonly fingerprint: string
    readonly publicKeyHex: string
    /** Unix milliseconds. */
    readonly expiresAt: number
  }
  | { readonly type: "approval-cancel"; readonly requestId: string }
  | {
    readonly type: "signal"
    /** Stamped by the directory from the sender's socket, never taken from the frame. */
    readonly from: string
    readonly session: string
    readonly purpose: SignalPurpose
    readonly relay: boolean
    readonly data: SignalData
  }
  | { readonly type: "ice-servers"; readonly requestId: string; readonly iceServers: readonly IceServer[] }
  | ({ readonly type: "relay-status" } & RelayStatus)
  | { readonly type: "inbox-created"; readonly requestId: string; readonly inboxId: string; readonly url: string }
  | {
    readonly type: "inbox-event"
    readonly eventId: string
    readonly inboxId: string
    /** Unix milliseconds. */
    readonly receivedAt: number
    /** Sealed box (`crypto_box_seal`) to the machine key, base64. */
    readonly sealed: string
  }
  | {
    readonly type: "error"
    readonly code: ConnectErrorCode
    readonly message: string
    readonly requestId?: string
    readonly session?: string
  }
