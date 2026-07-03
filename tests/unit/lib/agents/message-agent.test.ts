import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  deliverAgentMessage: vi.fn(),
  sessionExists: vi.fn(),
  listPaneValues: vi.fn(),
  waitForAgentIdle: vi.fn(),
  appendOperatorInterventionEvent: vi.fn(),
  logAgentLifecycleSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  getAgentDir: (agentId: string) => `/tmp/${agentId}`,
  getAgentResumeGateBlockReason: (state: { paused?: boolean; troubled?: boolean; consecutiveFailures?: number }) => {
    if (state.paused) return 'agent is paused';
    if (state.troubled) return `agent is troubled (${state.consecutiveFailures ?? 0} failures)`;
    return undefined;
  },
  getAgentStateSync: mocks.getAgentStateSync,
  markAgentRunning: vi.fn(),
  saveAgentStateSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/runtime-state.js', () => ({
  getAgentRuntimeStateSync: mocks.getAgentRuntimeStateSync,
}));

vi.mock('../../../../src/lib/agents/identity.js', () => ({
  clearReadySignal: vi.fn(),
  normalizeAgentId: (agentId: string) => agentId,
  waitForAgentIdle: mocks.waitForAgentIdle,
}));

vi.mock('../../../../src/lib/agents/delivery.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
  deliverResumeMessageWithTranscriptConfirmation: vi.fn(),
  resilientDeliveryMethod: (method: unknown) => method,
}));

vi.mock('../../../../src/lib/tmux.js', () => ({
  createSession: vi.fn(),
  killSession: vi.fn(),
  listPaneValues: mocks.listPaneValues,
  sessionExists: mocks.sessionExists,
}));

vi.mock('../../../../src/lib/agents/runtime-command.js', () => ({
  claudeSystemPromptFiles: vi.fn(),
  getCodexLauncherFields: vi.fn(),
  getOhmypiLauncherFields: vi.fn(),
  getRoleRuntimeBaseCommand: vi.fn(),
  hasAgentRuntimeInSubtree: vi.fn(),
  waitForPromptReady: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/activity.js', () => ({
  getLatestSessionIdSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/supervisor-channels.js', () => ({
  buildResumeMessageForAgent: vi.fn(),
  markKickoffRedelivered: vi.fn(),
  prepareSupervisorForRelaunch: vi.fn(),
}));

vi.mock('../../../../src/lib/operator-interventions.js', () => ({
  appendOperatorInterventionEvent: mocks.appendOperatorInterventionEvent,
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntrySync: vi.fn(),
}));

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycleSync: mocks.logAgentLifecycleSync,
}));

vi.mock('../../../../src/lib/providers.js', () => ({
  clearCredentialFileAuthSync: vi.fn(),
  getProviderForModelSync: vi.fn(),
  setupCredentialFileAuthSync: vi.fn(),
}));

vi.mock('../../../../src/lib/launcher-generator.js', () => ({
  generateLauncherScriptSync: vi.fn(),
}));

vi.mock('../../../../src/lib/child-env.js', () => ({
  BLANKED_PROVIDER_ENV: {},
}));

vi.mock('../../../../src/lib/session-rotation.js', () => ({
  ALLOW_SESSION_ROTATION_ON_RESUME: false,
}));

vi.mock('../../../../src/lib/agents/provider-env.js', () => ({
  getProviderEnvForModel: vi.fn(),
  getProviderExportsForModel: vi.fn(),
}));

import { messageAgent } from '../../../../src/lib/agents/messaging.js';

describe('messageAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentRuntimeStateSync.mockReturnValue({ state: 'idle', lastActivity: new Date().toISOString() });
    mocks.sessionExists.mockReturnValue(Effect.succeed(true));
    mocks.listPaneValues.mockReturnValue(Effect.succeed([]));
    mocks.waitForAgentIdle.mockResolvedValue(true);
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true });
  });

  it('delivers to a troubled agent when its tmux session is live', async () => {
    mocks.getAgentStateSync.mockReturnValue({
      id: 'agent-pan-2262',
      issueId: 'PAN-2262',
      status: 'running',
      workspace: '/repo',
      troubled: true,
      consecutiveFailures: 3,
    });

    await messageAgent('agent-pan-2262', 'review feedback', 'pan-tell');

    expect(mocks.deliverAgentMessage).toHaveBeenCalledWith(
      'agent-pan-2262',
      'review feedback',
      'messageAgent:pan-tell',
      undefined,
    );
    expect(mocks.logAgentLifecycleSync).not.toHaveBeenCalledWith(
      'agent-pan-2262',
      expect.stringContaining('queued mail without resume'),
    );
  });
});
