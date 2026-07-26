import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../../../../src/lib/agents/agent-state.js';

const STOP_AFTER_STATE_SAVE = new Error('stop after state save');

const mocks = vi.hoisted(() => ({
  activeRunId: null as string | null,
  savedAsync: [] as AgentState[],
  savedSync: [] as AgentState[],
}));

vi.mock('../../../../src/lib/overdeck/control-settings.js', () => ({
  getFlywheelActiveRunIdSync: () => mocks.activeRunId,
}));

vi.mock('../../../../src/lib/agents/agent-state.js', async () => {
  const { Effect } = await import('effect');
  return {
    getAgentDir: (agentId: string) => `/tmp/agents/${agentId}`,
    markAgentRunning: vi.fn(),
    recordStartupSessionExit: vi.fn(),
    saveAgentState: (state: AgentState) => Effect.sync(() => {
      mocks.savedAsync.push({ ...state });
      throw STOP_AFTER_STATE_SAVE;
    }),
    saveAgentStateSync: (state: AgentState) => {
      mocks.savedSync.push({ ...state });
      throw STOP_AFTER_STATE_SAVE;
    },
    SESSION_EXITED_BEFORE_KICKOFF: 'session-exited-before-kickoff',
  };
});

vi.mock('../../../../src/lib/agents/spawn-prep.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/lib/agents/spawn-prep.js')>(),
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
}));

vi.mock('../../../../src/lib/tmux.js', async () => {
  const { Effect } = await import('effect');
  return {
    createSession: vi.fn(() => Effect.void),
    exactPaneTarget: (session: string) => `${session}:0.0`,
    sessionExists: vi.fn(() => Effect.succeed(false)),
    setOption: vi.fn(() => Effect.void),
  };
});

vi.mock('../../../../src/lib/hooks.js', () => ({
  checkHookSync: vi.fn(() => ({ hasWork: false })),
  generateFixedPointPromptSync: vi.fn(() => ''),
  initHookSync: vi.fn(),
}));

vi.mock('../../../../src/lib/providers.js', () => ({
  clearCredentialFileAuthSync: vi.fn(),
  getProviderForModelSync: vi.fn(() => ({ name: 'anthropic', authType: 'env' })),
  setupCredentialFileAuthSync: vi.fn(),
}));

vi.mock('../../../../src/lib/harness-resolve.js', () => ({
  resolveHarness: vi.fn(async () => 'claude-code'),
}));

vi.mock('../../../../src/lib/harness-binary.js', () => ({
  prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: 'claude', pathExport: '' })),
}));

vi.mock('../../../../src/lib/codex-auth.js', () => ({
  assertCodexNativeAuthForSpawn: vi.fn(),
}));

vi.mock('../../../../src/lib/runtimes/behavior.js', () => ({
  getHarnessBehavior: vi.fn(() => ({ launchCommandKind: 'claude' })),
}));

vi.mock('../../../../src/lib/agents/provider-env.js', () => ({
  determineModel: vi.fn(() => 'claude-sonnet-5'),
  getProviderEnvForModel: vi.fn(async () => ({})),
  getProviderExportsForModel: vi.fn(async () => []),
}));

vi.mock('../../../../src/lib/agents/runtime-command.js', () => ({
  claudeSystemPromptFiles: vi.fn(async () => []),
  getAcpLauncherFields: vi.fn(() => ({})),
  getCodexLauncherFields: vi.fn(() => ({})),
  getOhmypiLauncherFields: vi.fn(async () => ({})),
  getProviderAuthMode: vi.fn(async () => 'api-key'),
  getRoleRuntimeBaseCommand: vi.fn(async () => 'claude'),
  waitForPromptReady: vi.fn(async () => true),
  writeLauncherScriptAtomic: vi.fn(async () => undefined),
  writeOhmypiAgentPrompt: vi.fn(async () => undefined),
}));

vi.mock('../../../../src/lib/agents/queries.js', () => ({
  listAgentStates: vi.fn(() => []),
}));

vi.mock('../../../../src/lib/agents/supervisor-channels.js', () => ({
  decideChannelsForWorkAgent: vi.fn(() => ({ eligible: false })),
  dismissDevChannelsDialog: vi.fn(async () => undefined),
  prepareSupervisorForFreshLaunch: vi.fn(async () => ({ useSupervisor: false })),
  recordKickoffDeliveryFailure: vi.fn(async () => undefined),
  writeChannelsBridgeMcpConfig: vi.fn(async () => undefined),
}));

vi.mock('../../../../src/lib/session-history.js', () => ({
  createFreshSessionIdentity: vi.fn(() => 'session-id'),
  logLauncherSessionPinned: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/hook-readiness.js', () => ({
  ensureLifecycleHooksBeforeLaunch: vi.fn(async () => undefined),
}));

import { spawnAgent, spawnRun } from '../../../../src/lib/agents/spawn.js';
import { agentStateToDbAgent } from '../../../../src/lib/database/agent-mappers.js';

describe('spawn flywheel provenance', () => {
  let savedStartedBy: string | undefined;

  beforeEach(() => {
    mocks.activeRunId = null;
    mocks.savedAsync.length = 0;
    mocks.savedSync.length = 0;
    savedStartedBy = process.env['OVERDECK_AGENT_STARTED_BY'];
    delete process.env['OVERDECK_AGENT_STARTED_BY'];
  });

  afterEach(() => {
    if (savedStartedBy === undefined) delete process.env['OVERDECK_AGENT_STARTED_BY'];
    else process.env['OVERDECK_AGENT_STARTED_BY'] = savedStartedBy;
  });

  it('persists an explicit flywheel run id in spawnAgent state', async () => {
    await expect(spawnAgent({
      issueId: 'PAN-3111',
      workspace: '/tmp/workspace',
      role: 'knowledge',
      flywheelRunId: 'RUN-71',
      startedBy: 'operator:cli:pan-start',
    })).rejects.toThrow(STOP_AFTER_STATE_SAVE.message);

    expect(mocks.savedSync).toHaveLength(1);
    expect(mocks.savedSync[0]).toMatchObject({
      id: 'agent-pan-3111',
      flywheelRunId: 'RUN-71',
      startedBy: 'operator:cli:pan-start',
    });
    expect(agentStateToDbAgent(mocks.savedSync[0]!).flywheelRunId).toBe('RUN-71');
  });

  it('persists the same flywheel run id in spawnRun state', async () => {
    await expect(spawnRun('PAN-3111', 'test', {
      workspace: '/tmp/workspace',
      flywheelRunId: 'RUN-71',
    })).rejects.toThrow(STOP_AFTER_STATE_SAVE.message);

    expect(mocks.savedAsync).toHaveLength(1);
    expect(mocks.savedAsync[0]).toMatchObject({
      id: 'agent-pan-3111-test',
      flywheelRunId: 'RUN-71',
      startedBy: 'flywheel:RUN-71',
    });
  });

  it('falls back to the active flywheel run when no explicit origin token is set', async () => {
    mocks.activeRunId = 'RUN-72';

    await expect(spawnAgent({
      issueId: 'PAN-3111',
      workspace: '/tmp/workspace',
      role: 'knowledge',
    })).rejects.toThrow(STOP_AFTER_STATE_SAVE.message);

    expect(mocks.savedSync[0]).toMatchObject({
      flywheelRunId: 'RUN-72',
      startedBy: 'flywheel:RUN-72',
    });
  });

  it('prefers the started-by environment token over the flywheel fallback', async () => {
    process.env['OVERDECK_AGENT_STARTED_BY'] = 'operator:dashboard:start';

    await expect(spawnAgent({
      issueId: 'PAN-3111',
      workspace: '/tmp/workspace',
      role: 'knowledge',
      flywheelRunId: 'RUN-71',
    })).rejects.toThrow(STOP_AFTER_STATE_SAVE.message);

    expect(mocks.savedSync[0]?.startedBy).toBe('operator:dashboard:start');
  });

  it('fails before persistence when no provenance source is available', async () => {
    await expect(spawnAgent({
      issueId: 'PAN-3111',
      workspace: '/tmp/workspace',
      role: 'knowledge',
    } as any)).rejects.toThrow('Agent spawn provenance is required');

    expect(mocks.savedSync).toHaveLength(0);
  });
});
