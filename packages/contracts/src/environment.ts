// Environment descriptor and environment-scoped references (PAN-3762 FR-1, FR-2, FR-11).
//
// Every Overdeck server is an "environment" with a stable public identity. The
// descriptor is served unauthenticated by `GET /api/environment`, so it carries
// no paths, usernames, tokens or secrets. Scoped refs pair a server-local id
// with the environment that owns it, so a client talking to several machines
// never confuses two agents (or issues, terminals, …) that share a local id.

import { Schema } from "effect"

/** Wire protocol version a client and server must agree on. */
export const ENVIRONMENT_PROTOCOL_VERSION = 1

export const EnvironmentId = Schema.String.pipe(Schema.brand("EnvironmentId"))
export type EnvironmentId = typeof EnvironmentId.Type

export const EnvironmentCapabilities = Schema.Struct({
  /** `POST /api/pairing/*` is available. */
  pairing: Schema.Boolean,
  /** `GET/DELETE /api/devices` is available. */
  deviceSessions: Schema.Boolean,
  /** `/ws/*` upgrades require a credential (PAN-1166). */
  terminalAuth: Schema.Boolean,
})
export type EnvironmentCapabilities = typeof EnvironmentCapabilities.Type

export const EnvironmentDescriptor = Schema.Struct({
  descriptorVersion: Schema.Literal(1),
  environmentId: EnvironmentId,
  label: Schema.String,
  platform: Schema.Struct({ os: Schema.String, arch: Schema.String }),
  /** Exact package version of the serving Overdeck. */
  serverVersion: Schema.String,
  /** The server's `ENVIRONMENT_PROTOCOL_VERSION`. */
  protocolVersion: Schema.Number,
  capabilities: EnvironmentCapabilities,
})
export type EnvironmentDescriptor = typeof EnvironmentDescriptor.Type

/** A server-local id qualified by the environment that owns it. */
export const ScopedRef = <A extends Schema.Top>(localId: A) =>
  Schema.Struct({ environmentId: EnvironmentId, localId })

export const ScopedProjectRef = ScopedRef(Schema.String)
export type ScopedProjectRef = typeof ScopedProjectRef.Type

export const ScopedIssueRef = ScopedRef(Schema.String)
export type ScopedIssueRef = typeof ScopedIssueRef.Type

export const ScopedAgentRef = ScopedRef(Schema.String)
export type ScopedAgentRef = typeof ScopedAgentRef.Type

export const ScopedConversationRef = ScopedRef(Schema.String)
export type ScopedConversationRef = typeof ScopedConversationRef.Type

export const ScopedTerminalRef = ScopedRef(Schema.String)
export type ScopedTerminalRef = typeof ScopedTerminalRef.Type

/** True only when the server speaks exactly the client's protocol version. */
export function isProtocolCompatible(
  descriptor: Pick<EnvironmentDescriptor, "protocolVersion">,
  clientProtocolVersion: number,
): boolean {
  return descriptor.protocolVersion === clientProtocolVersion
}
