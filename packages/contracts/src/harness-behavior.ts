import type { Harness } from "./types"

export type RuntimeName = Harness
export type HarnessName = RuntimeName | "pi"

export type HarnessLaunchCommandKind = "claude-code" | "ohmypi-rpc" | "codex-work-tui" | "codex-app-server" | "acp-host" | "kimi-code-tui"
export type HarnessDeliveryKind =
  | "pty-supervisor"
  | "rpc-fifo"
  | "codex-exec-resume"
  | "codex-app-server-rpc"
  | "acp-host-rpc"
  | "tmux-paste"
export type HarnessReadinessKind =
  | "claude-session-signal"
  | "ohmypi-ready-file"
  | "codex-tui-prompt"
  | "codex-app-server-ready"
  | "acp-host-ready"
  | "kimi-session-signal"
export type HarnessTranscriptKind = "claude-jsonl" | "ohmypi-jsonl" | "codex-rollout-jsonl" | "acp-jsonl" | "kimi-wire-jsonl"
export type HarnessSessionIdSource = "launcher-session-id" | "transcript-jsonl" | "codex-thread-id" | "acp-session-id" | "kimi-session-newest"
export type HarnessContextLayerKind = "claude" | "pi" | "codex" | "acp" | "kimi-code"
export type HarnessFeedKind = "claude_code" | "pi" | "codex" | "acp" | "kimi_code"

export interface HarnessNativeCommand {
  readonly name: string
  readonly description: string
  readonly insert: string
}

export interface HarnessBehavior {
  readonly displayName: string
  readonly nativeCommands?: readonly HarnessNativeCommand[]
  readonly executableName: string
  readonly processNames: readonly string[]
  readonly launchCommandKind: HarnessLaunchCommandKind
  readonly deliveryKind: HarnessDeliveryKind
  readonly readinessKind: HarnessReadinessKind
  readonly transcriptKind: HarnessTranscriptKind
  readonly sessionIdSource: HarnessSessionIdSource
  readonly contextLayerKind: HarnessContextLayerKind
  readonly feedKind: HarnessFeedKind
  readonly supportsPtySupervisor: boolean
  readonly supportsChannelsBridge: boolean
  readonly supportsConversationStreaming: boolean
  readonly supportsPatchProjection: boolean
  readonly usesRpcFifo: boolean
  readonly usesCodexHome: boolean
  readonly injectsPromptTimeMemory: boolean
  readonly workAgentMode: "claude-code" | "ohmypi-rpc" | "codex-work-tui" | "codex-app-server" | "acp-host" | "kimi-code-tui"
  readonly readyTimeoutSeconds: number
}

export const CLAUDE_CODE_BEHAVIOR: HarnessBehavior = {
  displayName: "Claude Code",
  // Verified from the installed Claude Code 2.1.209 binary on 2026-07-24.
  nativeCommands: [
    { name: "/model", description: "Switch the AI model for this conversation", insert: "/model " },
    { name: "/context", description: "Inspect or expand the current context window", insert: "/context " },
    { name: "/effort", description: "Set the reasoning effort level", insert: "/effort " },
    { name: "/cancel", description: "Cancel the current operation", insert: "/cancel" },
  ],
  executableName: "claude",
  processNames: ["claude"],
  launchCommandKind: "claude-code",
  deliveryKind: "pty-supervisor",
  readinessKind: "claude-session-signal",
  transcriptKind: "claude-jsonl",
  sessionIdSource: "launcher-session-id",
  contextLayerKind: "claude",
  feedKind: "claude_code",
  supportsPtySupervisor: true,
  supportsChannelsBridge: true,
  supportsConversationStreaming: false,
  supportsPatchProjection: true,
  usesRpcFifo: false,
  usesCodexHome: false,
  injectsPromptTimeMemory: false,
  workAgentMode: "claude-code",
  readyTimeoutSeconds: 30,
}

export const OHMYPI_BEHAVIOR: HarnessBehavior = {
  displayName: "Pi",
  // omp 16.3.11 does not expose a machine-readable native slash-command inventory (checked 2026-07-24).
  nativeCommands: [],
  executableName: "omp",
  processNames: ["omp"],
  launchCommandKind: "ohmypi-rpc",
  deliveryKind: "rpc-fifo",
  readinessKind: "ohmypi-ready-file",
  transcriptKind: "ohmypi-jsonl",
  sessionIdSource: "transcript-jsonl",
  contextLayerKind: "pi",
  feedKind: "pi",
  supportsPtySupervisor: false,
  supportsChannelsBridge: false,
  supportsConversationStreaming: true,
  supportsPatchProjection: false,
  usesRpcFifo: true,
  usesCodexHome: false,
  injectsPromptTimeMemory: true,
  workAgentMode: "ohmypi-rpc",
  readyTimeoutSeconds: 120,
}

export const CODEX_BEHAVIOR: HarnessBehavior = {
  displayName: "Codex",
  // Codex CLI 0.144.4 does not expose a machine-readable native slash-command inventory (checked 2026-07-24).
  nativeCommands: [],
  executableName: "codex",
  processNames: ["codex"],
  launchCommandKind: "codex-work-tui",
  deliveryKind: "codex-exec-resume",
  readinessKind: "codex-tui-prompt",
  transcriptKind: "codex-rollout-jsonl",
  sessionIdSource: "codex-thread-id",
  contextLayerKind: "codex",
  feedKind: "codex",
  supportsPtySupervisor: true,
  supportsChannelsBridge: false,
  supportsConversationStreaming: true,
  supportsPatchProjection: true,
  usesRpcFifo: false,
  usesCodexHome: true,
  injectsPromptTimeMemory: false,
  workAgentMode: "codex-work-tui",
  readyTimeoutSeconds: 30,
}

export const ACP_BEHAVIOR: HarnessBehavior = {
  displayName: "ACP",
  // Kimi Code CLI 0.28.1 via ACP does not expose a machine-readable native slash-command inventory (checked 2026-07-24).
  nativeCommands: [],
  executableName: "acp-host",
  processNames: ["acp-host", "kimi"],
  launchCommandKind: "acp-host",
  deliveryKind: "acp-host-rpc",
  readinessKind: "acp-host-ready",
  transcriptKind: "acp-jsonl",
  sessionIdSource: "acp-session-id",
  contextLayerKind: "acp",
  feedKind: "acp",
  supportsPtySupervisor: false,
  supportsChannelsBridge: false,
  supportsConversationStreaming: true,
  supportsPatchProjection: false,
  usesRpcFifo: false,
  usesCodexHome: false,
  injectsPromptTimeMemory: false,
  workAgentMode: "acp-host",
  readyTimeoutSeconds: 30,
}

export const KIMI_CODE_BEHAVIOR: HarnessBehavior = {
  displayName: "Kimi Code",
  nativeCommands: [], // no machine-readable inventory verified yet
  executableName: "kimi",
  processNames: ["kimi"],
  launchCommandKind: "kimi-code-tui",
  deliveryKind: "pty-supervisor",
  readinessKind: "kimi-session-signal",
  transcriptKind: "kimi-wire-jsonl",
  sessionIdSource: "kimi-session-newest",
  contextLayerKind: "kimi-code",
  feedKind: "kimi_code",
  supportsPtySupervisor: true,
  supportsChannelsBridge: false,
  supportsConversationStreaming: true,
  supportsPatchProjection: false,
  usesRpcFifo: false,
  usesCodexHome: false,
  injectsPromptTimeMemory: false,
  workAgentMode: "kimi-code-tui",
  readyTimeoutSeconds: 60,
}

const BEHAVIORS: Record<RuntimeName, HarnessBehavior> = {
  "claude-code": CLAUDE_CODE_BEHAVIOR,
  ohmypi: OHMYPI_BEHAVIOR,
  codex: CODEX_BEHAVIOR,
  acp: ACP_BEHAVIOR,
  "kimi-code": KIMI_CODE_BEHAVIOR,
}

export function getHarnessBehavior(harness: HarnessName | undefined | null): HarnessBehavior {
  if (harness === "ohmypi" || harness === "pi") return OHMYPI_BEHAVIOR
  if (harness === "codex") return CODEX_BEHAVIOR
  if (harness === "acp") return ACP_BEHAVIOR
  if (harness === "kimi-code") return KIMI_CODE_BEHAVIOR
  return CLAUDE_CODE_BEHAVIOR
}

export function getRuntimeBehavior(runtime: RuntimeName): HarnessBehavior {
  return BEHAVIORS[runtime]
}
