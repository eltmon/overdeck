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
/** message = an AskUserQuestion answer is sent as a conversation message; pi-ask-modal = keystrokes drive the open ask modal (a queued message would be swallowed); codex-approval = answered as a numbered approval prompt (PAN-4944), not a question. */
export type HarnessAskAnswerDelivery = "message" | "pi-ask-modal" | "codex-approval"
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
  /** Argv after the binary that updates the CLI in place, or null when Overdeck must not update it (PAN-4654). */
  readonly updateArgs: readonly string[] | null
  /** npm package of the CLI; a binary installed under <prefix>/lib/node_modules/<package>/ is updated with npm (PAN-4654). */
  readonly npmPackage: string | null
  /** Config key holding an operator-configured binary path, or null for none. */
  readonly binaryConfigKey: HarnessBinaryConfigKey | null
  /** Preflight check run before a launch, or null for none. */
  readonly launchPreflight: HarnessLaunchPreflight | null
  /** How the conversation scanner resolves a transcript's workspace. */
  readonly workspaceResolution: HarnessWorkspaceResolution
  /** The conversation scanner correlates transcripts to agents by session id. */
  readonly correlatesBySessionId: boolean
  /**
   * The MCP `answer_question` tool may answer this harness's pending question with a composed
   * message (PAN-4649). Narrower than `askAnswerDelivery`: the tool carries no toolUseId, so it
   * cannot tell a Codex approval from a question and serves only harnesses where a message is
   * always the answer.
   */
  readonly answersQuestionByMessage: boolean
  /** How the dashboard delivers an operator's answer to a pending AskUserQuestion in a conversation. */
  readonly askAnswerDelivery: HarnessAskAnswerDelivery
  /** A conversation may be started on a Fly machine (pan machines add-fly): Claude Code (PAN-4652) and Codex (PAN-4296). */
  readonly runsOnFlyMachine: boolean
  /** Launches get the `overdeck` MCP server with a per-agent token (PAN-4927 D-13): Claude Code (PAN-4932) and the ACP harnesses (PAN-4934). Codex follows (W-INJ2). */
  readonly overdeckMcp: boolean
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
  "updateArgs",
  "npmPackage",
  "binaryConfigKey",
  "launchPreflight",
  "workspaceResolution",
  "correlatesBySessionId",
  "answersQuestionByMessage",
  "askAnswerDelivery",
  "runsOnFlyMachine",
  "overdeckMcp",
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
  updateArgs: ["update"],
  npmPackage: "@anthropic-ai/claude-code",
  binaryConfigKey: null,
  launchPreflight: "claude-code-model-minimum",
  workspaceResolution: "claude-project-hash",
  correlatesBySessionId: false,
  answersQuestionByMessage: true,
  askAnswerDelivery: "message",
  runsOnFlyMachine: true,
  overdeckMcp: true,
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
  updateArgs: null,
  npmPackage: null,
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "first-message-only",
  correlatesBySessionId: true,
  answersQuestionByMessage: false,
  askAnswerDelivery: "pi-ask-modal",
  runsOnFlyMachine: false,
  overdeckMcp: false,
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
  updateArgs: ["update"],
  npmPackage: "@openai/codex",
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "agent-dir",
  correlatesBySessionId: true,
  answersQuestionByMessage: false,
  askAnswerDelivery: "codex-approval",
  runsOnFlyMachine: true,
  overdeckMcp: false,
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
  updateArgs: ["upgrade", "--yes"],
  npmPackage: null,
  binaryConfigKey: "acp.kimi.binaryPath",
  launchPreflight: null,
  workspaceResolution: "agent-dir",
  correlatesBySessionId: true,
  answersQuestionByMessage: false,
  askAnswerDelivery: "message",
  runsOnFlyMachine: false,
  overdeckMcp: true,
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
  updateArgs: ["upgrade", "--yes"],
  npmPackage: null,
  binaryConfigKey: "kimiCode.binaryPath",
  launchPreflight: null,
  workspaceResolution: "first-message-only",
  correlatesBySessionId: true,
  answersQuestionByMessage: false,
  askAnswerDelivery: "message",
  runsOnFlyMachine: false,
  overdeckMcp: false,
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
  updateArgs: ["upgrade"],
  npmPackage: "opencode-ai",
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "agent-dir",
  correlatesBySessionId: true,
  answersQuestionByMessage: false,
  askAnswerDelivery: "message",
  runsOnFlyMachine: false,
  overdeckMcp: true,
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
  updateArgs: null,
  npmPackage: null,
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "first-message-only",
  correlatesBySessionId: true,
  answersQuestionByMessage: false,
  askAnswerDelivery: "message",
  runsOnFlyMachine: false,
  overdeckMcp: false,
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
  updateArgs: null,
  npmPackage: null,
  binaryConfigKey: null,
  launchPreflight: null,
  workspaceResolution: "first-message-only",
  correlatesBySessionId: true,
  answersQuestionByMessage: false,
  askAnswerDelivery: "message",
  runsOnFlyMachine: false,
  overdeckMcp: false,
}
