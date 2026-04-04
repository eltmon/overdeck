import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { DomainEvent } from "./events"
import { DashboardSnapshot, SequenceNumber } from "./types"

// ─── RPC method names ─────────────────────────────────────────────────────────

export const WS_METHODS = {
  // Streaming subscriptions
  subscribeDomainEvents: "pan.subscribeDomainEvents",
  subscribeTerminal: "pan.subscribeTerminal",
  subscribeAgentOutput: "pan.subscribeAgentOutput",

  // Snapshot / replay
  getSnapshot: "pan.getSnapshot",
  replayEvents: "pan.replayEvents",

  // Terminal control
  terminalOpen: "pan.terminalOpen",
  terminalWrite: "pan.terminalWrite",
  terminalResize: "pan.terminalResize",
  terminalClose: "pan.terminalClose",
} as const

// ─── Error types ──────────────────────────────────────────────────────────────

export class PanRpcError extends Schema.TaggedErrorClass<PanRpcError>()("PanRpcError", {
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}

// ─── Terminal types ───────────────────────────────────────────────────────────

export const TerminalOutput = Schema.Struct({
  sessionName: Schema.String,
  data: Schema.String,
})
export type TerminalOutput = typeof TerminalOutput.Type

export const AgentOutput = Schema.Struct({
  agentId: Schema.String,
  line: Schema.String,
})
export type AgentOutput = typeof AgentOutput.Type

// ─── RPC definitions ──────────────────────────────────────────────────────────

/** 1. Subscribe to the live domain event stream (stream) */
export const SubscribeDomainEventsRpc = Rpc.make(WS_METHODS.subscribeDomainEvents, {
  payload: Schema.Struct({}),
  success: DomainEvent,
  stream: true,
})

/** 2. Subscribe to raw terminal output for a tmux session (stream) */
export const SubscribeTerminalRpc = Rpc.make(WS_METHODS.subscribeTerminal, {
  payload: Schema.Struct({ sessionName: Schema.String, cols: Schema.Number, rows: Schema.Number }),
  success: TerminalOutput,
  error: PanRpcError,
  stream: true,
})

/** 3. Subscribe to buffered agent stdout (stream) */
export const SubscribeAgentOutputRpc = Rpc.make(WS_METHODS.subscribeAgentOutput, {
  payload: Schema.Struct({ agentId: Schema.String }),
  success: AgentOutput,
  error: PanRpcError,
  stream: true,
})

/** 4. Get current dashboard snapshot (unary) */
export const GetSnapshotRpc = Rpc.make(WS_METHODS.getSnapshot, {
  payload: Schema.Struct({}),
  success: DashboardSnapshot,
  error: PanRpcError,
})

/** 5. Replay events since a given sequence number (unary) */
export const ReplayEventsRpc = Rpc.make(WS_METHODS.replayEvents, {
  payload: Schema.Struct({ fromSequence: SequenceNumber }),
  success: Schema.Array(DomainEvent),
  error: PanRpcError,
})

/** 6. Open a terminal session / attach PTY (unary) */
export const TerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: Schema.Struct({ sessionName: Schema.String, cols: Schema.Number, rows: Schema.Number }),
  success: Schema.Struct({ sessionName: Schema.String }),
  error: PanRpcError,
})

/** 7. Write data to a terminal session (unary) */
export const TerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: Schema.Struct({ sessionName: Schema.String, data: Schema.String }),
  error: PanRpcError,
})

/** 8. Resize a terminal session (unary) */
export const TerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: Schema.Struct({ sessionName: Schema.String, cols: Schema.Number, rows: Schema.Number }),
  error: PanRpcError,
})

/** 9. Close a terminal session (unary) */
export const TerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: Schema.Struct({ sessionName: Schema.String }),
  error: PanRpcError,
})

// ─── RPC Group ────────────────────────────────────────────────────────────────

/** All 9 Panopticon WebSocket RPC methods */
export const PanRpcGroup = RpcGroup.make(
  SubscribeDomainEventsRpc,
  SubscribeTerminalRpc,
  SubscribeAgentOutputRpc,
  GetSnapshotRpc,
  ReplayEventsRpc,
  TerminalOpenRpc,
  TerminalWriteRpc,
  TerminalResizeRpc,
  TerminalCloseRpc,
)
export type PanRpcGroup = typeof PanRpcGroup
