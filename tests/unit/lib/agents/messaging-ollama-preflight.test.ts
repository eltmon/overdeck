import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { rmSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getProviderEnvForModel: vi.fn(),
  resumeAgent: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  decideResumeGate: () => ({ decision: 'proceed', clearStoppedByUser: false }),
  getAgentDir: (agentId: string) => `/tmp/${agentId}`,
  getAgentResumeGateBlockReason: vi.fn(),
  getAgentStateSync: () => ({
    id: 'agent-pan-1641-preflight',
    issueId: 'PAN-1641',
    status: 'stopped',
    workspace: '/tmp/pan-1641-workspace',
    role: 'work',
    harness: 'ohmypi',
    model: 'ollama:gemma4:12b',
  }),
  markAgentRunning: vi.fn(),
  saveAgentStateSync: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/runtime-state.js', () => ({
  getAgentRuntimeStateSync: () => ({ state: 'idle' }),
}));

vi.mock('../../../../src/lib/agents/identity.js', () => ({
  clearReadySignal: vi.fn(),
  normalizeAgentId: (agentId: string) => agentId,
  waitForAgentIdle: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/delivery.js', () => ({
  deliverAgentMessage: vi.fn(),
  deliverResumeMessageWithTranscriptConfirmation: vi.fn(),
  resilientDeliveryMethod: (method: unknown) => method,
}));

vi.mock('../../../../src/lib/agents/eaten-message-watcher.js', () => ({ watchForEatenAgentMessage: vi.fn() }));
vi.mock('../../../../src/lib/transcript-landing.js', () => ({ captureTranscriptUserRecordSnapshot: vi.fn() }));
vi.mock('../../../../src/lib/tmux.js', () => ({
  createSession: (...args: unknown[]) => Effect.promise(() => Promise.resolve(mocks.createSession(...args))),
  killSession: vi.fn(() => Effect.void),
  listPaneValues: vi.fn(() => Effect.succeed([])),
  sessionExists: vi.fn(() => Effect.succeed(false)),
}));

vi.mock('../../../../src/lib/agents/runtime-command.js', () => ({
  claudeSystemPromptFiles: vi.fn(async () => []),
  getCodexAppServerStatus: vi.fn(async () => { throw new Error('no app-server'); }),
  getCodexLauncherFields: vi.fn(),
  getOhmypiLauncherFields: vi.fn(async () => ({})),
  getRoleRuntimeBaseCommand: vi.fn(async () => ['omp']),
  hasAgentRuntimeInSubtree: vi.fn(),
  waitForPromptReady: vi.fn(async () => false),
}));

vi.mock('../../../../src/lib/agents/activity.js', () => ({ getLatestSessionIdSync: vi.fn() }));
vi.mock('../../../../src/lib/agents/supervisor-channels.js', () => ({
  buildResumeMessageForAgent: vi.fn(async () => ({ message: 'resume' })),
  markKickoffRedelivered: vi.fn(),
  prepareSupervisorForRelaunch: vi.fn(async () => ({ useSupervisor: false })),
}));
vi.mock('../../../../src/lib/operator-interventions.js', () => ({ appendOperatorInterventionEvent: vi.fn() }));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntrySync: vi.fn() }));
vi.mock('../../../../src/lib/persistent-logger.js', () => ({ logAgentLifecycleSync: vi.fn() }));
vi.mock('../../../../src/lib/providers.js', () => ({
  clearCredentialFileAuthSync: vi.fn(),
  getProviderForModelSync: vi.fn(() => ({ authType: 'api-key' })),
  setupCredentialFileAuthSync: vi.fn(),
}));
vi.mock('../../../../src/lib/launcher-generator.js', () => ({ generateLauncherScriptSync: vi.fn(() => '#!/bin/sh') }));
vi.mock('../../../../src/lib/ohmypi-models.js', () => ({ provisionOhmypiProviderForModel: vi.fn() }));
vi.mock('../../../../src/lib/harness-binary.js', () => ({ prepareHarnessLaunch: vi.fn(async () => ({ pathExport: '' })) }));
vi.mock('../../../../src/lib/child-env.js', () => ({ BLANKED_PROVIDER_ENV: {} }));
vi.mock('../../../../src/lib/session-rotation.js', () => ({ ALLOW_SESSION_ROTATION_ON_RESUME: true }));
vi.mock('../../../../src/lib/agents.js', () => ({
  assertWorkspaceStackHealthyForSpawn: vi.fn(),
  resumeAgent: mocks.resumeAgent,
}));
vi.mock('../../../../src/lib/agents/provider-env.js', () => ({
  getProviderEnvForModel: mocks.getProviderEnvForModel,
  getProviderExportsForModel: vi.fn(async () => []),
}));

import { messageAgent } from '../../../../src/lib/agents/messaging.js';

describe('messageAgent Ollama fallback preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resumeAgent.mockResolvedValue({ success: false, error: 'session not found' });
  });

  afterEach(() => {
    rmSync('/tmp/agent-pan-1641-preflight', { recursive: true, force: true });
  });

  it('waits for the Ollama preflight before recreating the stopped agent session', async () => {
    let resolvePreflight!: (env: Record<string, string>) => void;
    mocks.getProviderEnvForModel.mockReturnValue(new Promise(resolve => { resolvePreflight = resolve; }));

    const resultPromise = messageAgent('agent-pan-1641-preflight', 'continue');
    await vi.waitFor(() => expect(mocks.getProviderEnvForModel).toHaveBeenCalledWith('ollama:gemma4:12b'));
    expect(mocks.createSession).not.toHaveBeenCalled();

    resolvePreflight({ OPENAI_BASE_URL: 'http://localhost:11434/v1' });
    await resultPromise;

    expect(mocks.createSession).toHaveBeenCalledOnce();
  });

  it('does not recreate the session when the Ollama preflight fails', async () => {
    mocks.getProviderEnvForModel.mockRejectedValue(new Error('Ollama model is unavailable'));

    await expect(messageAgent('agent-pan-1641-preflight', 'continue'))
      .rejects.toThrow('Ollama model is unavailable');

    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
