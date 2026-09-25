import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * FR-12: the stopped-agent relaunch fallback must run the Ollama preflight
 * (getProviderEnvForModel) to completion BEFORE it recreates the terminal
 * session. A pane created first would show a live agent pointed at a server
 * that may not be up, and the preflight's actionable error would never reach
 * the operator. This test pins the ordering; if it goes red, move the
 * preflight above the session recreation in messaging.ts — never weaken it.
 */

const AGENT_ROOT = mkdtempSync(join(tmpdir(), 'pan-1641-preflight-'));

const mocks = vi.hoisted(() => ({
  launchAgentPane: vi.fn(),
  getProviderEnvForModel: vi.fn(),
  resumeAgent: vi.fn(),
}));

const AGENT_STATE = {
  id: 'agent-pan-1641-preflight',
  issueId: 'PAN-1641',
  status: 'stopped',
  workspace: '/tmp/pan-1641-workspace',
  role: 'work',
  harness: 'claude-code',
  model: 'ollama:gemma4:12b',
};

vi.mock('../../../../src/lib/agents/agent-state.js', () => ({
  decideResumeGate: () => ({ decision: 'proceed', clearStoppedByUser: false }),
  getAgentDir: (agentId: string) => join(AGENT_ROOT, agentId),
  getAgentResumeGateBlockReason: vi.fn(),
  getIssuePause: () => ({ status: 'unknown', stoppedAgents: [] }),
  getAgentState: () => ({ ...AGENT_STATE }),
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

vi.mock('../../../../src/lib/agents/liveness.js', () => ({
  isAlive: vi.fn(async () => ({ alive: false })),
  isConfirmedDead: vi.fn(async () => true),
}));

vi.mock('../../../../src/lib/agents/delivery.js', () => ({
  deliverAgentMessage: vi.fn(),
  deliverMessageWithTranscriptConfirmation: vi.fn(async () => ({ ok: true })),
  resilientDeliveryMethod: (method: unknown) => method,
}));

vi.mock('../../../../src/lib/agents/monitor-transport.js', () => ({
  formatMailFileContent: (message: string) => message,
}));

vi.mock('../../../../src/lib/terminal-backends/launch.js', () => ({
  closeAgentPane: vi.fn(async () => {}),
  launchAgentPane: mocks.launchAgentPane,
}));
vi.mock('../../../../src/lib/terminal-backends/prompt-guard.js', () => ({
  toPaneRole: (role: string) => role,
}));

vi.mock('../../../../src/lib/agents/runtime-command.js', () => ({
  claudeSystemPromptFiles: vi.fn(async () => []),
  getCodexAppServerStatus: vi.fn(async () => { throw new Error('no app-server'); }),
  getCodexLauncherFields: vi.fn(() => ({})),
  getOhmypiLauncherFields: vi.fn(async () => ({})),
  getRoleRuntimeBaseCommand: vi.fn(async () => ['claude']),
  waitForPromptReady: vi.fn(async () => false),
}));

vi.mock('../../../../src/lib/agents/activity.js', () => ({ getLatestSessionId: vi.fn(() => undefined) }));
vi.mock('../../../../src/lib/agents/supervisor-channels.js', () => ({
  buildResumeMessageForAgent: vi.fn(async () => ({ message: 'resume' })),
  markKickoffRedelivered: vi.fn(),
  prepareSupervisorForRelaunch: vi.fn(async () => ({ useSupervisor: false })),
}));
vi.mock('../../../../src/lib/operator-interventions.js', () => ({ appendOperatorInterventionEvent: vi.fn() }));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
vi.mock('../../../../src/lib/persistent-logger.js', () => ({ logAgentLifecycle: vi.fn() }));
vi.mock('../../../../src/lib/providers.js', () => ({
  clearCredentialFileAuth: vi.fn(),
  getProviderForModel: vi.fn(() => ({ name: 'ollama', authType: 'static' })),
  setupCredentialFileAuth: vi.fn(),
}));
vi.mock('../../../../src/lib/runtimes/behavior.js', () => ({
  getHarnessBehavior: vi.fn(() => ({})),
}));
vi.mock('../../../../src/lib/launcher-generator.js', () => ({ generateLauncherScript: vi.fn(() => '#!/bin/sh') }));
vi.mock('../../../../src/lib/harness-binary.js', () => ({ prepareHarnessLaunch: vi.fn(async () => ({ pathExport: '' })) }));
vi.mock('../../../../src/lib/child-env.js', () => ({ BLANKED_PROVIDER_ENV: {} }));
vi.mock('../../../../src/lib/session-rotation.js', () => ({ ALLOW_SESSION_ROTATION_ON_RESUME: true }));
vi.mock('../../../../src/lib/agents.js', () => ({
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => {}),
  resolveRoutedSpawnModel: vi.fn(() => 'ollama:gemma4:12b'),
  resumeAgent: mocks.resumeAgent,
}));
vi.mock('../../../../src/lib/agents/provider-env.js', () => ({
  getProviderEnvForModel: mocks.getProviderEnvForModel,
  getProviderExportsForModel: vi.fn(async () => ''),
}));

import { messageAgent } from '../../../../src/lib/agents/messaging.js';

describe('messageAgent relaunch fallback runs the Ollama preflight first (PAN-1641 FR-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resumeAgent.mockResolvedValue({ success: false, error: 'session not found' });
    mocks.launchAgentPane.mockResolvedValue({ backend: 'herdr', paneId: 'pane-1' });
  });

  afterEach(() => {
    rmSync(join(AGENT_ROOT, 'agent-pan-1641-preflight'), { recursive: true, force: true });
  });

  it('does not create the session until the preflight resolves', async () => {
    let resolvePreflight!: (env: Record<string, string>) => void;
    mocks.getProviderEnvForModel.mockReturnValue(
      new Promise<Record<string, string>>((resolve) => { resolvePreflight = resolve; }),
    );

    const resultPromise = messageAgent('agent-pan-1641-preflight', 'continue');

    await vi.waitFor(() =>
      expect(mocks.getProviderEnvForModel).toHaveBeenCalledWith('ollama:gemma4:12b'),
    );
    expect(mocks.launchAgentPane).not.toHaveBeenCalled();

    resolvePreflight({ ANTHROPIC_BASE_URL: 'http://localhost:11434' });
    await resultPromise;

    expect(mocks.launchAgentPane).toHaveBeenCalledOnce();
  });

  it('never creates the session when the preflight rejects', async () => {
    mocks.getProviderEnvForModel.mockRejectedValue(
      new Error('Ollama model gemma4:12b is not pulled. Run `ollama pull gemma4:12b`.'),
    );

    await expect(messageAgent('agent-pan-1641-preflight', 'continue')).rejects.toThrow(
      /ollama pull gemma4:12b/,
    );
    expect(mocks.launchAgentPane).not.toHaveBeenCalled();
  });
});
