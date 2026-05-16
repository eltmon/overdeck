import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { DomainEvent } from "./events"
import {
  AgentStatus,
  ConversationCostSummary,
  ConversationFilter,
  DashboardSnapshot,
  DiscoveredSessionSnapshot,
  IssueId,
  ScanResult,
  SequenceNumber,
  SessionNodePresence,
  WorkspaceDetail,
} from "./types"
import { EditorIdSchema, OpenInEditorInput } from "./editor"

// ─── RPC method names ─────────────────────────────────────────────────────────

export const WS_METHODS = {
  // Conversations (PAN-457)
  scanConversations: "pan.scanConversations",
  searchConversations: "pan.searchConversations",
  listDiscoveredSessions: "pan.listDiscoveredSessions",
  getDiscoveredSession: "pan.getDiscoveredSession",
  enrichSessions: "pan.enrichSessions",
  embedSessions: "pan.embedSessions",
  getConversationCost: "pan.getConversationCost",

  // Streaming subscriptions
  subscribeDomainEvents: "pan.subscribeDomainEvents",
  subscribeTerminal: "pan.subscribeTerminal",
  subscribeAgentOutput: "pan.subscribeAgentOutput",
  subscribeConversationMessages: "pan.subscribeConversationMessages",
  subscribeProjectSessionTree: "pan.subscribeProjectSessionTree",

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

  // Editor integration (PAN-966)
  shellOpenInEditor: "pan.shellOpenInEditor",
  getAvailableEditors: "pan.getAvailableEditors",
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

// ─── Plan mode types ─────────────────────────────────────────────────────────

export const ProposedPlan = Schema.Struct({
  id: Schema.String,
  plan: Schema.String,
  planFilePath: Schema.optional(Schema.String),
  status: Schema.Literals(['pending', 'approved', 'rejected']),
  createdAt: Schema.String,
  resolvedAt: Schema.optional(Schema.String),
})
export type ProposedPlan = typeof ProposedPlan.Type

// ─── Compact boundary types ──────────────────────────────────────────────────

export const CompactBoundary = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  trigger: Schema.optional(Schema.String),
  preTokens: Schema.optional(Schema.Number),
  model: Schema.optional(Schema.String),
})
export type CompactBoundary = typeof CompactBoundary.Type

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
  proposedPlan?: ProposedPlan;
  compactBoundaries?: CompactBoundary[];
}

export const ConversationEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('messages'),
    messages: Schema.Array(ChatMessage),
    workLog: Schema.Array(WorkLogEntry),
    streaming: Schema.Boolean,
    proposedPlan: Schema.optional(ProposedPlan),
    compactBoundaries: Schema.optional(Schema.Array(CompactBoundary)),
  }),
  Schema.Struct({
    kind: Schema.Literal('discovering'),
  }),
])
export type ConversationEvent = typeof ConversationEvent.Type

// ─── Session Tree Delta (PAN-821) ─────────────────────────────────────────────

export const SessionTreeDelta = Schema.Struct({
  kind: Schema.Literals(['session_added', 'session_removed', 'presence_changed', 'status_changed']),
  issueId: Schema.String,
  sessionId: Schema.String,
  presence: Schema.optional(SessionNodePresence),
  status: Schema.optional(AgentStatus),
  timestamp: Schema.String,
})
export type SessionTreeDelta = typeof SessionTreeDelta.Type

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

/** 17. Subscribe to live session tree deltas for a project (stream, PAN-821) */
export const SubscribeProjectSessionTreeRpc = Rpc.make(WS_METHODS.subscribeProjectSessionTree, {
  payload: Schema.Struct({ projectKey: Schema.String }),
  success: SessionTreeDelta,
  error: PanRpcError,
  stream: true,
})

/** 18. Open a workspace in an editor (PAN-966) */
export const ShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: PanRpcError,
})

/** 19. Get available (installed) editors (PAN-966) */
export const GetAvailableEditorsRpc = Rpc.make(WS_METHODS.getAvailableEditors, {
  success: Schema.Struct({ editors: Schema.Array(EditorIdSchema) }),
  error: PanRpcError,
})

// ─── Conversation Discovery RPC procs (PAN-457) ───────────────────────────────

/** Scan conversations (trigger discovery) */
export const ScanConversationsRpc = Rpc.make(WS_METHODS.scanConversations, {
  payload: Schema.Struct({
    mode: Schema.Literals(['targeted', 'watched', 'system']),
    dirs: Schema.optional(Schema.Array(Schema.String)),
    dryRun: Schema.optional(Schema.Boolean),
  }),
  success: ScanResult,
  error: PanRpcError,
})

/** Search discovered sessions with filters + optional FTS query */
export const SearchConversationsRpc = Rpc.make(WS_METHODS.searchConversations, {
  payload: ConversationFilter,
  success: Schema.Array(DiscoveredSessionSnapshot),
  error: PanRpcError,
})

/** List discovered sessions (recent, with optional managed/unmanaged filter) */
export const ListDiscoveredSessionsRpc = Rpc.make(WS_METHODS.listDiscoveredSessions, {
  payload: Schema.Struct({
    managed: Schema.optional(Schema.Boolean),
    limit: Schema.optional(Schema.Number),
    offset: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(DiscoveredSessionSnapshot),
  error: PanRpcError,
})

/** Get a single discovered session by ID */
export const GetDiscoveredSessionRpc = Rpc.make(WS_METHODS.getDiscoveredSession, {
  payload: Schema.Struct({ id: Schema.Number }),
  success: DiscoveredSessionSnapshot,
  error: PanRpcError,
})

/** Enrich sessions by ID or filter */
export const EnrichSessionsRpc = Rpc.make(WS_METHODS.enrichSessions, {
  payload: Schema.Struct({
    ids: Schema.optional(Schema.Array(Schema.Number)),
    filter: Schema.optional(ConversationFilter),
    level: Schema.Literals([1, 2, 3]),
    model: Schema.optional(Schema.String),
    fullTranscript: Schema.optional(Schema.Boolean),
    customPrompt: Schema.optional(Schema.String),
    upgrade: Schema.optional(Schema.Boolean),
    limit: Schema.optional(Schema.Number),
    confirmed: Schema.optional(Schema.Boolean),
    force: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    processed: Schema.Number,
    totalCost: Schema.Number,
    failures: Schema.Number,
  }),
  error: PanRpcError,
})

/** Generate or update embeddings for enriched sessions */
export const EmbedSessionsRpc = Rpc.make(WS_METHODS.embedSessions, {
  payload: Schema.Struct({
    ids: Schema.optional(Schema.Array(Schema.Number)),
    regenerate: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    total: Schema.Number,
    embedded: Schema.Number,
    model: Schema.String,
  }),
  error: PanRpcError,
})

/** Aggregate cost breakdown for discovered sessions */
export const GetConversationCostRpc = Rpc.make(WS_METHODS.getConversationCost, {
  payload: Schema.Struct({
    groupBy: Schema.optional(Schema.Literals(['workspace', 'model'])),
  }),
  success: ConversationCostSummary,
  error: PanRpcError,
})

// ─── RPC Group ────────────────────────────────────────────────────────────────

/** All Panopticon WebSocket RPC methods */
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
  SubscribeProjectSessionTreeRpc,
  ShellOpenInEditorRpc,
  GetAvailableEditorsRpc,
  ScanConversationsRpc,
  SearchConversationsRpc,
  ListDiscoveredSessionsRpc,
  GetDiscoveredSessionRpc,
  EnrichSessionsRpc,
  EmbedSessionsRpc,
  GetConversationCostRpc,
)
export type PanRpcGroup = typeof PanRpcGroup
