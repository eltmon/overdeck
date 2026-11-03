// Directory protocol (PAN-2356, Anywhere W-LINK5 / W-LINK8 / directory inbox): the frames a machine
// exchanges with its account's directory Durable Object at `wss://connect.overdeck.ai/v1/directory`,
// plus the constants and user-facing strings both sides share. PAN-4823 W-CON1 adds the phone app's
// client role (`ClientToDirectoryFrame` / `DirectoryToClientFrame`) and the sealed `push` /
// `push-result` frames; the directory serves them from W-CON2 (client role) and W-CON3 (push).
// `PhonePushPayload` is the plaintext a machine seals into `push` (PAN-4843).
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
/** Phones (directory clients) one account may register (PAN-4823 D-2, NFR-3). Clients never count as machines. */
export const CLIENT_LIMIT = 5
/** PAN-4927 D-18: connectors are counted apart from phones. */
export const CONNECTOR_LIMIT = 10
/** Pushes the directory forwards per account per minute (PAN-4823 D-9). */
export const PUSH_RATE_PER_MINUTE = 30
/**
 * Longest `sealed` field of a `push` frame, in base64 characters. It keeps the APNs and FCM bodies
 * well under their 4 KB limits.
 */
export const PUSH_SEALED_MAX_CHARS = 3_072
/**
 * Largest plaintext a machine may seal into one push: `crypto_box_seal` adds 48 bytes and base64
 * grows by 4/3, so 2,256 bytes seal to exactly `PUSH_SEALED_MAX_CHARS` characters.
 */
export const PUSH_PLAINTEXT_MAX_BYTES = 2_256

export const FREE_MACHINE_LIMIT_MESSAGE = "The free account includes 3 machines"
export const NO_DIRECT_PATH_MESSAGE = "No direct path; install Tailscale or use the relay plan"
export const RELAY_CAP_MESSAGE = "Relay allowance used; install Tailscale or add 50 GB"
export const CLIENT_LIMIT_MESSAGE = "This account already has 5 phones. Remove one in the app or on a machine."
export const CONNECTOR_LIMIT_MESSAGE = "This account already has 10 Overdeck connectors. Remove one in Settings → Anywhere → Bots."

/** WebSocket close codes the directory uses. */
export const CONNECT_CLOSE_CODES = {
  unauthorized: 4001,
  grantExpired: 4003,
  machineLimit: 4009,
  unsupportedProtocol: 4010,
  /** Replaced by a newer socket for the same machine. */
  replaced: 4011,
  forgotten: 4012,
  /** A sixth phone or an eleventh connector on one account (PAN-4823 D-2, PAN-4927 D-18). */
  clientLimit: 4013,
} as const
export type ConnectCloseCode = (typeof CONNECT_CLOSE_CODES)[keyof typeof CONNECT_CLOSE_CODES]

/** Account plan as the directory sees it (`Entitlement.plan` of the account service). */
export type ConnectPlan = "free" | "tester"

export type ConnectErrorCode =
  | "unauthorized" | "unsupported" | "machine_limit" | "peer_offline"
  | "approval_limit" | "approval_unknown" | "relay_not_allowed" | "relay_cap_reached"
  | "turn_unavailable" | "plan_required" | "bad_frame" | "client_limit"

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

/** A phone's platform: the only platforms that can hold a push registration. */
export type PhonePlatform = "ios" | "android"
/** A directory client's platform: a phone, or `node` for an Overdeck connector (PAN-4927 D-18). */
export type ClientPlatform = PhonePlatform | "node"
/** Which APNs host a token belongs to: Debug builds register `sandbox`, Release builds `production`. */
export type ApsEnvironment = "production" | "sandbox"
/** `high` for question, approval and failed; else `normal` (the Web Push rule). */
export type PushUrgency = "high" | "normal"
export type PushResultError = "no_registration" | "rate_limited" | "delivery_failed" | "unknown_client"

/** The plaintext a machine seals into a `push` frame (PAN-4843). UTF-8 JSON, at most PUSH_PLAINTEXT_MAX_BYTES. */
export interface PhonePushPayload {
  readonly v: 1
  /** The sending machine's environment id; the phone opens this machine when the notification is tapped. */
  readonly machine: string
  readonly kind: "question" | "approval" | "finished" | "failed" | "summary" | "test"
  /** The full title (the Web Push `title`), never `publicTitle`: the payload is end-to-end encrypted. */
  readonly title: string
  readonly body: string
  /** Same-origin dashboard path, e.g. `/m?subject=my-conv`. */
  readonly url: string
  /** Dedup and replace key; the phone uses it as the notification thread / tag. */
  readonly tag: string
  readonly issueId: string | null
  /** ISO 8601. */
  readonly ts: string
}

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
  /** A notification sealed to one phone's push key (PAN-4823 D-5). */
  | {
    readonly type: "push"
    /** 32 lowercase hex. */
    readonly requestId: string
    /** The phone's clientId (uuid v4). */
    readonly to: string
    /** `crypto_box_seal` to the phone's push key, base64, at most `PUSH_SEALED_MAX_CHARS`. */
    readonly sealed: string
    readonly urgency: PushUrgency
    /** 32 lowercase hex: the first 32 hex characters of sha256(notification tag). */
    readonly collapseId: string
  }

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
  /** The answer to one `push`; `no_registration` and `unknown_client` are not operator-facing errors. */
  | { readonly type: "push-result"; readonly requestId: string; readonly ok: true }
  | { readonly type: "push-result"; readonly requestId: string; readonly ok: false; readonly error: PushResultError }
  | {
    readonly type: "error"
    readonly code: ConnectErrorCode
    readonly message: string
    readonly requestId?: string
    readonly session?: string
  }

/** Phone (directory client) → directory (PAN-4823 W-CON1). */
export type ClientToDirectoryFrame =
  | {
    readonly type: "hello-client"
    readonly protocol: ConnectProtocolVersion
    /** uuid v4, generated once per app install. */
    readonly clientId: string
    /** At most 64 characters. */
    readonly label: string
    /**
     * The phone's install-level X25519 public key: its push public key (PAN-4837 C-2), 64 lowercase
     * hex. Link keys are per machine. A `node` client (connector) sends its install key here, not a
     * push key.
     */
    readonly publicKeyHex: string
    /** At most 32 characters. */
    readonly appVersion: string
    readonly platform: ClientPlatform
  }
  /** Same shape as the machine's `signal`, but a phone only ever opens link channels. */
  | {
    readonly type: "signal"
    /** The machine's environment id. */
    readonly to: string
    /** 32 lowercase hex. */
    readonly session: string
    readonly purpose: "link"
    readonly relay: boolean
    readonly data: SignalData
  }
  | Extract<MachineToDirectoryFrame, { type: "ice-servers" | "relay-usage" }>
  /** `token` is at most 4096 characters; `apsEnvironment` is sent by iOS only. */
  | { readonly type: "push-register"; readonly platform: PhonePlatform; readonly token: string; readonly apsEnvironment?: ApsEnvironment }
  | { readonly type: "push-unregister" }
  | { readonly type: "forget-client" }

/** Directory → phone. Clients reuse the machine frames below; they never get approvals or inbox frames. */
export type DirectoryToClientFrame =
  | {
    readonly type: "welcome-client"
    readonly protocol: ConnectProtocolVersion
    readonly plan: ConnectPlan
    readonly relayAllowed: boolean
    readonly machines: readonly DirectoryMachine[]
  }
  | Extract<DirectoryToMachineFrame, { type: "directory" | "signal" | "ice-servers" | "relay-status" | "error" }>
