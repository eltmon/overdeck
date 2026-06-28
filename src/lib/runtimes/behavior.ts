import type { HarnessBehavior, HarnessName, RuntimeName } from './types.js';

export const CLAUDE_CODE_BEHAVIOR: HarnessBehavior = {
  displayName: 'Claude Code',
  executableName: 'claude',
  processNames: ['claude'],
  launchCommandKind: 'claude-code',
  deliveryKind: 'pty-supervisor',
  readinessKind: 'claude-session-signal',
  transcriptKind: 'claude-jsonl',
  sessionIdSource: 'launcher-session-id',
  contextLayerKind: 'claude',
  feedKind: 'claude_code',
  supportsPtySupervisor: true,
  supportsChannelsBridge: true,
  supportsConversationStreaming: false,
  supportsPatchProjection: true,
  usesRpcFifo: false,
  usesCodexHome: false,
  injectsPromptTimeMemory: false,
  workAgentMode: 'claude-code',
  readyTimeoutSeconds: 30,
};

export const OHMYPI_BEHAVIOR: HarnessBehavior = {
  displayName: 'Pi',
  executableName: 'omp',
  processNames: ['omp'],
  launchCommandKind: 'ohmypi-rpc',
  deliveryKind: 'rpc-fifo',
  readinessKind: 'ohmypi-ready-file',
  transcriptKind: 'ohmypi-jsonl',
  sessionIdSource: 'transcript-jsonl',
  contextLayerKind: 'pi',
  feedKind: 'pi',
  supportsPtySupervisor: false,
  supportsChannelsBridge: false,
  supportsConversationStreaming: true,
  supportsPatchProjection: false,
  usesRpcFifo: true,
  usesCodexHome: false,
  injectsPromptTimeMemory: true,
  workAgentMode: 'ohmypi-rpc',
  readyTimeoutSeconds: 120,
};

export const CODEX_BEHAVIOR: HarnessBehavior = {
  displayName: 'Codex',
  executableName: 'codex',
  processNames: ['codex'],
  launchCommandKind: 'codex-work-tui',
  deliveryKind: 'codex-exec-resume',
  readinessKind: 'codex-tui-prompt',
  transcriptKind: 'codex-rollout-jsonl',
  sessionIdSource: 'codex-thread-id',
  contextLayerKind: 'codex',
  feedKind: 'codex',
  supportsPtySupervisor: true,
  supportsChannelsBridge: false,
  supportsConversationStreaming: true,
  supportsPatchProjection: true,
  usesRpcFifo: false,
  usesCodexHome: true,
  injectsPromptTimeMemory: false,
  workAgentMode: 'codex-work-tui',
  readyTimeoutSeconds: 30,
};

const BEHAVIORS: Record<RuntimeName, HarnessBehavior> = {
  'claude-code': CLAUDE_CODE_BEHAVIOR,
  ohmypi: OHMYPI_BEHAVIOR,
  codex: CODEX_BEHAVIOR,
};

export function getHarnessBehavior(harness: HarnessName | undefined | null): HarnessBehavior {
  if (harness === 'ohmypi' || harness === 'pi') return OHMYPI_BEHAVIOR;
  if (harness === 'codex') return CODEX_BEHAVIOR;
  return CLAUDE_CODE_BEHAVIOR;
}

export function getRuntimeBehavior(runtime: RuntimeName): HarnessBehavior {
  return BEHAVIORS[runtime];
}
