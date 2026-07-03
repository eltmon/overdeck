import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  execFileAsync: vi.fn(),
  existsSync: vi.fn(),
  deliverCommitForReview: vi.fn(),
  generateLauncherScriptSync: vi.fn(),
  getCurrentHead: vi.fn(),
  getDiffBase: vi.fn(),
  getDiffStats: vi.fn(),
  getProviderEnvForModel: vi.fn(),
  isIssueClosed: vi.fn(),
  killSession: vi.fn(),
  loadConfigSync: vi.fn(),
  loadPrdDraft: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readWorkspacePlanSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  saveAgentState: vi.fn(),
  sessionExists: vi.fn(),
  spawnTierSupervisor: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock('child_process', () => {
  function execFile(): void {
    throw new Error('execFile callback form is not used in inspect-agent tests');
  }

  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = mocks.execFileAsync;
  return { exec: vi.fn(), execFile };
});

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

vi.mock('../inspect-checkpoints.js', () => ({
  getCurrentHead: mocks.getCurrentHead,
  getDiffBase: mocks.getDiffBase,
  getDiffStats: mocks.getDiffStats,
  saveCheckpoint: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  setReviewStatusSync: vi.fn(),
}));

vi.mock('../../bd-mutex.js', () => ({
  withBdMutex: <T>(effect: T) => effect,
}));

vi.mock('../../launcher-generator.js', () => ({
  generateLauncherScriptSync: mocks.generateLauncherScriptSync,
}));

vi.mock('../../tmux.js', () => ({
  createSession: mocks.createSession,
  killSession: mocks.killSession,
  sessionExists: mocks.sessionExists,
}));

vi.mock('../../config-yaml.js', () => ({
  loadConfigSync: mocks.loadConfigSync,
  resolveModel: vi.fn(() => 'claude-sonnet-4-6'),
}));

vi.mock('../../claude-permissions.js', () => ({
  bypassPrefixForAgentFlagSync: vi.fn(() => ''),
  getClaudePermissionFlagsSync: vi.fn(() => []),
}));

vi.mock('../../providers.js', () => ({
  clearCredentialFileAuthSync: vi.fn(),
  getProviderForModelSync: vi.fn(() => ({ authType: 'none' })),
  setupCredentialFileAuthSync: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  getProviderEnvForModel: mocks.getProviderEnvForModel,
  saveAgentRuntimeState: mocks.saveAgentRuntimeState,
  saveAgentState: mocks.saveAgentState,
}));

vi.mock('../../vbrief/io.js', () => ({
  readWorkspacePlanSync: mocks.readWorkspacePlanSync,
}));

vi.mock('../../agents/tier-supervisor.js', () => ({
  deliverCommitForReview: mocks.deliverCommitForReview,
  loadPrdDraft: mocks.loadPrdDraft,
  spawnTierSupervisor: mocks.spawnTierSupervisor,
  supervisorAgentId: vi.fn((issueId: string) => `agent-${issueId.toLowerCase()}-review-supervisor`),
}));

import { spawnInspectAgent } from '../inspect-agent.js';

describe('spawnInspectAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mocks.killSession.mockReturnValue(Effect.succeed(undefined));
    mocks.createSession.mockReturnValue(Effect.succeed(undefined));
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue('Inspect {{issueId}} {{beadId}} {{diffBase}} {{diffStats}} {{beadDescription}}');
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ title: 'bead title' }), stderr: '' });
    mocks.getDiffBase.mockReturnValue(Effect.succeed('abcdef1234567890'));
    mocks.getDiffStats.mockReturnValue(Effect.succeed('diff stats'));
    mocks.getCurrentHead.mockReturnValue(Effect.succeed('fedcba9876543210'));
    mocks.getProviderEnvForModel.mockResolvedValue({});
    mocks.generateLauncherScriptSync.mockReturnValue('#!/usr/bin/env bash\n');
    mocks.saveAgentState.mockReturnValue(Effect.succeed(undefined));
    mocks.loadConfigSync.mockReturnValue({ config: {} });
    mocks.readWorkspacePlanSync.mockReturnValue(null);
    mocks.spawnTierSupervisor.mockResolvedValue({ id: 'agent-pan-1613-review-supervisor' });
    mocks.loadPrdDraft.mockResolvedValue('# PRD');
    mocks.deliverCommitForReview.mockResolvedValue({ delivered: true });
  });

  it('skips inspect dispatch when the issue is closed', async () => {
    mocks.isIssueClosed.mockResolvedValue(true);

    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      skipped: true,
      message: 'PAN-1613: skipping inspect dispatch — issue is closed',
    }));
    expect(mocks.sessionExists).not.toHaveBeenCalled();
    expect(mocks.generateLauncherScriptSync).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('spawns inspect normally when the issue is open', async () => {
    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      tmuxSession: 'inspect-pan-1613-workspace-b95lw',
      message: 'Spawned inspect for PAN-1613 bead workspace-b95lw',
    }));
    expect(result.skipped).toBeUndefined();
    expect(mocks.sessionExists).toHaveBeenCalledWith('inspect-pan-1613-workspace-b95lw');
    expect(mocks.generateLauncherScriptSync).toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith(
      'inspect-pan-1613-workspace-b95lw',
      '/workspace',
      expect.stringContaining('launcher.sh'),
      expect.any(Object),
    );
  });

  it('writes a minimal state.json so the inspect agent is enumerable', async () => {
    await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(mocks.saveAgentState).toHaveBeenCalledWith(expect.objectContaining({
      id: 'inspect-pan-1613-workspace-b95lw',
      issueId: 'PAN-1613',
      workspace: '/workspace',
      role: 'work',
      // PAN-1973: harness must be persisted (NOT NULL in the agents table) or the
      // cache backfill skips the row / pre-PAN-1972 crashed the boot decode.
      harness: 'claude-code',
      status: 'starting',
      inspectSubRole: 'inspect',
    }));
  });

  it('routes inspect to a live standing supervisor when owns_inspection is enabled', async () => {
    const item = planItem('workspace-b95lw');
    mocks.loadConfigSync.mockReturnValue({ config: { tieredExecution: tieredExecutionConfig() } });
    mocks.readWorkspacePlanSync.mockReturnValue(planDoc([item]));
    mocks.sessionExists.mockImplementation((session: string) => (
      Effect.succeed(session === 'agent-pan-1613-review-supervisor')
    ));

    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      tmuxSession: 'agent-pan-1613-review-supervisor',
      message: 'Routed inspect for PAN-1613 bead workspace-b95lw to standing supervisor',
    }));
    expect(mocks.spawnTierSupervisor).not.toHaveBeenCalled();
    expect(mocks.deliverCommitForReview).toHaveBeenCalledTimes(1);
    expect(mocks.deliverCommitForReview).toHaveBeenCalledWith(expect.objectContaining({
      supervisorAgentId: 'agent-pan-1613-review-supervisor',
      workspacePath: '/workspace',
      issueId: 'PAN-1613',
      item,
      sha: 'fedcba9876543210',
      beadId: 'workspace-b95lw',
      prdMarkdown: '# PRD',
    }));
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('starts the standing supervisor before delivery when owns_inspection is enabled and the supervisor is not alive', async () => {
    const tieredExecution = tieredExecutionConfig();
    mocks.loadConfigSync.mockReturnValue({ config: { tieredExecution } });
    mocks.readWorkspacePlanSync.mockReturnValue(planDoc([planItem('workspace-b95lw')]));
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));

    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result.success).toBe(true);
    expect(mocks.spawnTierSupervisor).toHaveBeenCalledWith('PAN-1613', tieredExecution.supervisor, {
      workspace: '/workspace',
    });
    expect(mocks.deliverCommitForReview).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('fails loudly without spawning an ephemeral inspector when standing supervisor spawn fails', async () => {
    mocks.loadConfigSync.mockReturnValue({ config: { tieredExecution: tieredExecutionConfig() } });
    mocks.readWorkspacePlanSync.mockReturnValue(planDoc([planItem('workspace-b95lw')]));
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mocks.spawnTierSupervisor.mockRejectedValue(new Error('supervisor unavailable'));

    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: false,
      message: 'Failed to spawn inspect: supervisor unavailable',
      error: 'supervisor unavailable',
    }));
    expect(mocks.deliverCommitForReview).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('uses the ephemeral inspector when tiered execution is disabled even if owns_inspection is configured', async () => {
    mocks.loadConfigSync.mockReturnValue({
      config: {
        tieredExecution: {
          ...tieredExecutionConfig(),
          enabled: false,
        },
      },
    });
    mocks.readWorkspacePlanSync.mockReturnValue(planDoc([planItem('workspace-b95lw')]));

    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      beadId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      tmuxSession: 'inspect-pan-1613-workspace-b95lw',
      message: 'Spawned inspect for PAN-1613 bead workspace-b95lw',
    }));
    expect(mocks.spawnTierSupervisor).not.toHaveBeenCalled();
    expect(mocks.deliverCommitForReview).not.toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });
});

function tieredExecutionConfig() {
  return {
    enabled: true,
    tiers: {},
    supervisor: {
      model: 'claude-opus-4-8',
      harness: 'claude-code',
      subscribe: 'flagged',
      owns_inspection: true,
    },
    by_kind: {},
    byKind: {},
    feed: {
      callouts: 'off',
      exclude: [],
      exclude_subjects: [],
      max_diff_bytes: null,
    },
    escalation: {
      enabled: false,
      retries_at_tier: 0,
      max_promotions: 0,
      flounder_budget_minutes: {},
    },
    replay_threshold: 0.5,
    difficultyToTier: {},
  };
}

function planItem(id: string) {
  return {
    id,
    title: 'Inspect routing bead',
    status: 'pending',
    metadata: { requiresInspection: false },
    items: [{ id: `${id}-ac`, title: 'routes through supervisor', status: 'pending' }],
  };
}

function planDoc(items: ReturnType<typeof planItem>[]) {
  return {
    vBRIEFInfo: {
      version: '0.6.0',
      created: '2026-07-02T00:00:00Z',
    },
    plan: {
      id: 'pan-1613',
      title: 'Test plan',
      status: 'approved',
      metadata: {},
      items,
      edges: [],
    },
  };
}
