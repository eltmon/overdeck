import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { DomainEvent } from "./events"
import { DashboardSnapshot, IssueId, SequenceNumber, WorkspaceDetail } from "./types"

// ─── RPC method names ─────────────────────────────────────────────────────────

export const WS_METHODS = {
  // Streaming subscriptions
  subscribeDomainEvents: "pan.subscribeDomainEvents",
  subscribeTerminal: "pan.subscribeTerminal",
  subscribeAgentOutput: "pan.subscribeAgentOutput",
  subscribeConversationMessages: "pan.subscribeConversationMessages",

  // Snapshot / replay
  getSnapshot: "pan.getSnapshot",
  replayEvents: "pan.replayEvents",

  // Workspace detail (batched)
  getWorkspaceDetail: "pan.getWorkspaceDetail",

  // Terminal control
  terminalOpen: "pan.terminalOpen",
  terminalWrite: "pan.terminalWrite",
  terminalResize: "pan.terminalResize",
  terminalClose: "pan.terminalClose",

  // Commands (trigger mutations via RPC)
  startPlanning: "pan.startPlanning",
  startAgent: "pan.startAgent",
  deepWipe: "pan.deepWipe",
  sendTerminalInput: "pan.sendTerminalInput",
  resizeTerminal: "pan.resizeTerminal",
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

// ─── Chat / conversation message types (PAN-451) ──────────────────────────────

export const ChatMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(['user', 'assistant', 'system']),
  text: Schema.String,
  turnId: Schema.optional(Schema.String),
  createdAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  streaming: Schema.optional(Schema.Boolean),
  sequence: Schema.optional(Schema.Number),
})
export type ChatMessage = typeof ChatMessage.Type

export const WorkLogEntry = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  label: Schema.String,
  detail: Schema.optional(Schema.String),
  /** Tool result output (populated when tool_result is received). */
  result: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  changedFiles: Schema.optional(Schema.Array(Schema.String)),
  tone: Schema.Literals(['thinking', 'tool', 'info', 'error']),
  toolTitle: Schema.optional(Schema.String),
  sequence: Schema.optional(Schema.Number),
})
export type WorkLogEntry = typeof WorkLogEntry.Type

/**
 * Response shape for GET /api/agents/:id/conversation.
 * Shared between the dashboard server route and the frontend TerminalPanel.
 */
export interface ConversationResponse {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  streaming: boolean;
  totalCost: number;
  byteOffset: number;
}

export const ConversationEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('messages'),
    messages: Schema.Array(ChatMessage),
    workLog: Schema.Array(WorkLogEntry),
    streaming: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal('discovering'),
  }),
])
export type ConversationEvent = typeof ConversationEvent.Type

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

/** 10. Get batched workspace detail (unary) — replaces 5 separate HTTP calls */
export const GetWorkspaceDetailRpc = Rpc.make(WS_METHODS.getWorkspaceDetail, {
  payload: Schema.Struct({ issueId: IssueId }),
  success: WorkspaceDetail,
  error: PanRpcError,
})

/** 11. Start planning for an issue (command) */
export const StartPlanningRpc = Rpc.make(WS_METHODS.startPlanning, {
  payload: Schema.Struct({ issueId: IssueId, options: Schema.optional(Schema.Unknown) }),
  success: Schema.Struct({ queued: Schema.Boolean }),
  error: PanRpcError,
})

/** 12. Start a work agent for an issue (command) */
export const StartAgentRpc = Rpc.make(WS_METHODS.startAgent, {
  payload: Schema.Struct({ issueId: IssueId, options: Schema.optional(Schema.Unknown) }),
  success: Schema.Struct({ agentId: Schema.String }),
  error: PanRpcError,
})

/** 13. Deep-wipe a workspace (destructive command — requires explicit confirmation) */
export const DeepWipeRpc = Rpc.make(WS_METHODS.deepWipe, {
  payload: Schema.Struct({ issueId: IssueId, deleteWorkspace: Schema.optional(Schema.Boolean) }),
  success: Schema.Struct({ wiped: Schema.Boolean }),
  error: PanRpcError,
})

/** 14. Send input to a terminal session (command) */
export const SendTerminalInputRpc = Rpc.make(WS_METHODS.sendTerminalInput, {
  payload: Schema.Struct({ sessionName: Schema.String, data: Schema.String }),
  error: PanRpcError,
})

/** 15. Resize a terminal session (command) */
export const ResizeTerminalRpc = Rpc.make(WS_METHODS.resizeTerminal, {
  payload: Schema.Struct({ sessionName: Schema.String, cols: Schema.Number, rows: Schema.Number }),
  error: PanRpcError,
})

/** 16. Subscribe to structured conversation messages from a JSONL session file (stream, PAN-451) */
export const SubscribeConversationMessagesRpc = Rpc.make(WS_METHODS.subscribeConversationMessages, {
  payload: Schema.Struct({ conversationName: Schema.String }),
  success: ConversationEvent,
  error: PanRpcError,
  stream: true,
})

// ─── RPC Group ────────────────────────────────────────────────────────────────

/** All 16 Panopticon WebSocket RPC methods */
export const PanRpcGroup = RpcGroup.make(
  SubscribeDomainEventsRpc,
  SubscribeTerminalRpc,
  SubscribeAgentOutputRpc,
  GetSnapshotRpc,
  ReplayEventsRpc,
  GetWorkspaceDetailRpc,
  TerminalOpenRpc,
  TerminalWriteRpc,
  TerminalResizeRpc,
  TerminalCloseRpc,
  StartPlanningRpc,
  StartAgentRpc,
  DeepWipeRpc,
  SendTerminalInputRpc,
  ResizeTerminalRpc,
  SubscribeConversationMessagesRpc,
)
export type PanRpcGroup = typeof PanRpcGroup
