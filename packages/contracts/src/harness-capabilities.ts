// Declared per-harness behavior decisions (PAN-4562). Consumers read these
// fields instead of comparing harness names, so a new harness changes behavior
// by declaring its capabilities, with no consumer code change.

/** How the launcher delivers Overdeck's context layer to the harness (recorded in the context receipt). */
export type HarnessContextChannel =
  | "append-system-prompt-file"
  | "append-system-prompt"
  | "developer_instructions"
  | "initial-message-envelope"
  | "acp-initial-context"
  | "prime-agent-append-system-prompt"
export type HarnessAttachmentDelivery = "native" | "inline-paths"
export type HarnessBinaryConfigKey = "acp.kimi.binaryPath" | "kimiCode.binaryPath"
export type HarnessLaunchPreflight = "claude-code-model-minimum"
/** claude-project-hash = resolve via HashResolver; agent-dir = first-message cwd, else the agent dir; first-message-only = first-message cwd, else null. */
export type HarnessWorkspaceResolution = "claude-project-hash" | "agent-dir" | "first-message-only"

export interface HarnessCapabilities {
  /** Channel the launcher delivers the context layer through. */
  readonly contextChannel: HarnessContextChannel
  /** A conversation start fails unless the initial prompt is confirmed delivered. */
  readonly initialPromptMustLand: boolean
  /** A failed conversation start stops the runtime it launched. */
  readonly stopRuntimeOnStartFailure: boolean
  /** A resume fails unless the resume contract message is confirmed delivered. */
  readonly resumeContractMustLand: boolean
  /** Stopping a conversation also reaps the harness's private daemon. */
  readonly reapsPrivateDaemonOnStop: boolean
  /** native = the harness takes attachments itself; inline-paths = attachment paths are inlined into the message. */
  readonly attachmentDelivery: HarnessAttachmentDelivery
  /** The harness has a native manual /compact command. */
  readonly nativeManualCompact: boolean
  /** Message sends check the pane for a pending input prompt before pasting. */
  readonly paneInputGuard: boolean
  /** Message delivery is confirmed by reading the transcript for the sent turn. */
  readonly transcriptDeliveryReceipt: boolean
  /** The launch host accepts an effort flag for the harness. */
  readonly hostEffortFlag: boolean
  /** Human label used in binary-resolution messages. */
  readonly binaryLabel: string
  /** Install command shown when the binary is missing, or null for none. */
  readonly installHint: string | null
  /** Config key holding an operator-configured binary path, or null for none. */
  readonly binaryConfigKey: HarnessBinaryConfigKey | null
  /** Preflight check run before a launch, or null for none. */
  readonly launchPreflight: HarnessLaunchPreflight | null
  /** How the conversation scanner resolves a transcript's workspace. */
  readonly workspaceResolution: HarnessWorkspaceResolution
  /** The conversation scanner correlates transcripts to agents by session id. */
  readonly correlatesBySessionId: boolean
}

export const HARNESS_CAPABILITY_KEYS = [
  "contextChannel",
  "initialPromptMustLand",
  "stopRuntimeOnStartFailure",
  "resumeContractMustLand",
  "reapsPrivateDaemonOnStop",
  "attachmentDelivery",
  "nativeManualCompact",
  "paneInputGuard",
  "transcriptDeliveryReceipt",
  "hostEffortFlag",
  "binaryLabel",
  "installHint",
  "binaryConfigKey",
  "launchPreflight",
  "workspaceResolution",
  "correlatesBySessionId",
] as const satisfies readonly (keyof HarnessCapabilities)[]

export const CLAUDE_CODE_CAPABILITIES: HarnessCapabilities = {
  contextChannel: "append-system-prompt-file",
  initialPromptMustLand: false,
  stopRuntimeOnStartFailure: false,
  resumeContractMustLand: false,
  reapsPrivateDaemonOnStop: false,
  attachmentDelivery: "native",
  nativeManualCompact: true,
  paneInputGuard: true,
  transcriptDeliveryReceipt: true,
  hostEffortFlag: false,
  binaryLabel: "Claude Code",
  installHint: "curl -fsSL https://claude.ai/install.sh | bash",
  binaryConfigKey: null,
  launchPreflight: "claude-code-model-minimum",
  workspaceResolution: "claude-project-hash",
  correlatesBySessionId: false,
}

export const OHMYPI_CAPABILITIES: HarnessCapabilities = {
  contextChannel: "append-system-prompt",
  initialPromptMustLand: false,
  stopRuntimeOnStartFailure: false,
  resumeContractMustLand: false,
  reapsPrivateDaemonOnStop: false,
  attachmentDelivery: "inline-paths",
  nativeManualCompact: false,
  paneInputGuard: false,
  transcriptDeliveryReceipt: false,
  hostEffortFlag: false,
  binaryLabel: "OhMyPi",
  installHint: null,
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "first-message-only",
  correlatesBySessionId: true,
}

export const CODEX_CAPABILITIES: HarnessCapabilities = {
  contextChannel: "developer_instructions",
  initialPromptMustLand: false,
  stopRuntimeOnStartFailure: false,
  resumeContractMustLand: false,
  reapsPrivateDaemonOnStop: false,
  attachmentDelivery: "inline-paths",
  nativeManualCompact: false,
  paneInputGuard: false,
  transcriptDeliveryReceipt: false,
  hostEffortFlag: false,
  binaryLabel: "Codex CLI",
  installHint: null,
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "agent-dir",
  correlatesBySessionId: true,
}

export const ACP_CAPABILITIES: HarnessCapabilities = {
  contextChannel: "acp-initial-context",
  initialPromptMustLand: true,
  stopRuntimeOnStartFailure: true,
  resumeContractMustLand: false,
  reapsPrivateDaemonOnStop: false,
  attachmentDelivery: "inline-paths",
  nativeManualCompact: false,
  paneInputGuard: false,
  transcriptDeliveryReceipt: false,
  hostEffortFlag: false,
  binaryLabel: "Kimi Code CLI",
  installHint: null,
  binaryConfigKey: "acp.kimi.binaryPath",
  launchPreflight: null,
  workspaceResolution: "agent-dir",
  correlatesBySessionId: true,
}

export const KIMI_CODE_CAPABILITIES: HarnessCapabilities = {
  contextChannel: "initial-message-envelope",
  initialPromptMustLand: true,
  stopRuntimeOnStartFailure: true,
  resumeContractMustLand: true,
  reapsPrivateDaemonOnStop: false,
  attachmentDelivery: "inline-paths",
  nativeManualCompact: false,
  paneInputGuard: false,
  transcriptDeliveryReceipt: false,
  hostEffortFlag: false,
  binaryLabel: "Kimi Code CLI",
  installHint: null,
  binaryConfigKey: "kimiCode.binaryPath",
  launchPreflight: null,
  workspaceResolution: "first-message-only",
  correlatesBySessionId: true,
}

export const OPENCODE_CAPABILITIES: HarnessCapabilities = {
  contextChannel: "acp-initial-context",
  initialPromptMustLand: true,
  stopRuntimeOnStartFailure: true,
  resumeContractMustLand: false,
  reapsPrivateDaemonOnStop: false,
  attachmentDelivery: "inline-paths",
  nativeManualCompact: false,
  paneInputGuard: false,
  transcriptDeliveryReceipt: false,
  hostEffortFlag: true,
  binaryLabel: "OpenCode",
  installHint: null,
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "agent-dir",
  correlatesBySessionId: true,
}

export const MUSE_CAPABILITIES: HarnessCapabilities = {
  contextChannel: "append-system-prompt-file",
  initialPromptMustLand: false,
  stopRuntimeOnStartFailure: true,
  resumeContractMustLand: false,
  reapsPrivateDaemonOnStop: false,
  attachmentDelivery: "inline-paths",
  nativeManualCompact: false,
  paneInputGuard: false,
  transcriptDeliveryReceipt: false,
  hostEffortFlag: false,
  binaryLabel: "Muse Code",
  installHint: null,
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "first-message-only",
  correlatesBySessionId: true,
}

export const PRIME_AGENT_CAPABILITIES: HarnessCapabilities = {
  contextChannel: "prime-agent-append-system-prompt",
  initialPromptMustLand: true,
  stopRuntimeOnStartFailure: true,
  resumeContractMustLand: false,
  reapsPrivateDaemonOnStop: true,
  attachmentDelivery: "inline-paths",
  nativeManualCompact: false,
  paneInputGuard: false,
  transcriptDeliveryReceipt: false,
  hostEffortFlag: false,
  binaryLabel: "Prime Agent",
  installHint: null,
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "first-message-only",
  correlatesBySessionId: true,
}
