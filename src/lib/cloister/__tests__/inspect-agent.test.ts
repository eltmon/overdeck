import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  execFileAsync: vi.fn(),
  existsSync: vi.fn(),
  deliverAgentMessage: vi.fn(),
  deliverCommitForReview: vi.fn(),
  generateLauncherScriptSync: vi.fn(),
  getCurrentHead: vi.fn(),
  getInspectDiffContext: vi.fn(),
  getProviderEnvForModel: vi.fn(),
  isIssueClosed: vi.fn(),
  killSession: vi.fn(),
  loadConfigSync: vi.fn(),
  loadPrdDraft: vi.fn(),
  mkdirSync: vi.fn(),
  prepareHarnessLaunch: vi.fn(),
  readFileSync: vi.fn(),
  readWorkspacePlanSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  saveAgentState: vi.fn(),
  sessionExists: vi.fn(),
  spawnTierSupervisor: vi.fn(),
  surfaceIssueFeedbackNeedsYou: vi.fn(),
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
  getInspectDiffContext: mocks.getInspectDiffContext,
  saveCheckpoint: vi.fn(),
}));

vi.mock('../../review-status.js', () => ({
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../bd-mutex.js', () => ({
  withBdMutex: <T>(effect: T) => effect,
}));

vi.mock('../../harness-binary.js', () => ({
  prepareHarnessLaunch: mocks.prepareHarnessLaunch,
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

vi.mock('../../xbrief/io.js', () => ({
  readWorkspacePlanSync: mocks.readWorkspacePlanSync,
}));

vi.mock('../../agents/tier-supervisor.js', () => ({
  deliverCommitForReview: mocks.deliverCommitForReview,
  loadPrdDraft: mocks.loadPrdDraft,
  spawnTierSupervisor: mocks.spawnTierSupervisor,
  supervisorAgentId: vi.fn((issueId: string) => `agent-${issueId.toLowerCase()}-review-supervisor`),
}));

vi.mock('../../agents/delivery.js', () => ({
  deliverAgentMessage: mocks.deliverAgentMessage,
}));

vi.mock('../feedback-target.js', () => ({
  surfaceIssueFeedbackNeedsYou: mocks.surfaceIssueFeedbackNeedsYou,
}));

import { onInspectComplete, spawnInspectAgent } from '../inspect-agent.js';

describe('spawnInspectAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mocks.killSession.mockReturnValue(Effect.succeed(undefined));
    mocks.createSession.mockReturnValue(Effect.succeed(undefined));
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue('Inspect {{issueId}} {{itemId}} {{diffCommand}} {{diffStats}} {{itemDescription}}');
    mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ title: 'task title' }), stderr: '' });
    mocks.getInspectDiffContext.mockReturnValue(Effect.succeed({
      currentHead: 'fedcba9876543210',
      checkpoint: 'abcdef12',
      diffStats: 'diff stats',
      diffCommand: 'git diff abcdef1234567890...HEAD',
      repos: [],
    }));
    mocks.getCurrentHead.mockReturnValue(Effect.succeed('fedcba9876543210'));
    mocks.getProviderEnvForModel.mockResolvedValue({});
    mocks.prepareHarnessLaunch.mockResolvedValue({
      binaryPath: '/home/test/.local/bin/claude',
      pathExport: `export PATH='/home/test/.local/bin':"$PATH"`,
    });
    mocks.generateLauncherScriptSync.mockReturnValue('#!/usr/bin/env bash\n');
    mocks.saveAgentState.mockReturnValue(Effect.succeed(undefined));
    mocks.loadConfigSync.mockReturnValue({ config: {} });
    mocks.readWorkspacePlanSync.mockReturnValue(planDoc([planItem('workspace-b95lw')]));
    mocks.spawnTierSupervisor.mockResolvedValue({ id: 'agent-pan-1613-review-supervisor' });
    mocks.loadPrdDraft.mockResolvedValue('# PRD');
    mocks.deliverCommitForReview.mockResolvedValue({ delivered: true });
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'supervisor' });
  });

  it('skips inspect dispatch when the issue is closed', async () => {
    mocks.isIssueClosed.mockResolvedValue(true);

    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      itemId: 'workspace-b95lw',
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
      itemId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      tmuxSession: 'inspect-pan-1613-workspace-b95lw',
      message: 'Spawned inspect for PAN-1613 item workspace-b95lw',
    }));
    expect(result.skipped).toBeUndefined();
    expect(mocks.prepareHarnessLaunch).toHaveBeenCalledWith('claude-code');
    expect(mocks.sessionExists).toHaveBeenCalledWith('inspect-pan-1613-workspace-b95lw');
    expect(mocks.generateLauncherScriptSync).toHaveBeenCalledWith(expect.objectContaining({
      extraEnvExports: [`export PATH='/home/test/.local/bin':"$PATH"`],
      // PAN-3077: --effort must never be omitted; unset config resolves to high.
      extraArgs: '--effort high',
    }));
    expect(mocks.createSession).toHaveBeenCalledWith(
      'inspect-pan-1613-workspace-b95lw',
      '/workspace',
      expect.stringContaining('launcher.sh'),
      expect.any(Object),
    );
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-1613', expect.objectContaining({
      inspectStatus: 'inspecting',
      inspectBeadId: 'workspace-b95lw',
      inspectOwnerSession: 'inspect-pan-1613-workspace-b95lw',
    }));
  });

  it('does not create a tmux session when Claude is missing', async () => {
    mocks.prepareHarnessLaunch.mockRejectedValue(
      new Error('Claude Code executable was not found. Install Claude Code or add its installation directory to PATH, then restart Overdeck. No terminal session was created.'),
    );

    const result = await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-2869',
      itemId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: expect.stringContaining('Install Claude Code or add its installation directory to PATH'),
    }));
    expect(result.error).not.toContain('execvp');
    expect(mocks.sessionExists).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('writes a minimal state.json so the inspect agent is enumerable', async () => {
    await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      itemId: 'workspace-b95lw',
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
      itemId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      tmuxSession: 'agent-pan-1613-review-supervisor',
      message: 'Routed inspect for PAN-1613 item workspace-b95lw to standing supervisor',
    }));
    expect(mocks.spawnTierSupervisor).not.toHaveBeenCalled();
    expect(mocks.deliverCommitForReview).toHaveBeenCalledTimes(1);
    expect(mocks.deliverCommitForReview).toHaveBeenCalledWith(expect.objectContaining({
      supervisorAgentId: 'agent-pan-1613-review-supervisor',
      workspacePath: '/workspace',
      issueId: 'PAN-1613',
      item,
      sha: 'fedcba9876543210',
      itemId: 'workspace-b95lw',
      prdMarkdown: '# PRD',
    }));
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-1613', expect.objectContaining({
      inspectStatus: 'inspecting',
      inspectBeadId: 'workspace-b95lw',
      inspectOwnerSession: 'agent-pan-1613-review-supervisor',
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
      itemId: 'workspace-b95lw',
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
      itemId: 'workspace-b95lw',
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
      itemId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(result).toEqual(expect.objectContaining({
      success: true,
      tmuxSession: 'inspect-pan-1613-workspace-b95lw',
      message: 'Spawned inspect for PAN-1613 item workspace-b95lw',
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

describe('spawnInspectAgent --effort (PAN-3077)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.sessionExists.mockReturnValue(Effect.succeed(false));
    mocks.createSession.mockReturnValue(Effect.succeed(undefined));
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue('Inspect {{issueId}} {{itemId}} {{diffCommand}} {{diffStats}} {{itemDescription}}');
    mocks.getInspectDiffContext.mockReturnValue(Effect.succeed({
      currentHead: 'fedcba9876543210',
      checkpoint: 'abcdef12',
      diffStats: 'diff stats',
      diffCommand: 'git diff abcdef1234567890...HEAD',
      repos: [],
    }));
    mocks.getProviderEnvForModel.mockResolvedValue({});
    mocks.prepareHarnessLaunch.mockResolvedValue({
      binaryPath: '/home/test/.local/bin/claude',
      pathExport: `export PATH='/home/test/.local/bin':"$PATH"`,
    });
    mocks.generateLauncherScriptSync.mockReturnValue('#!/usr/bin/env bash\n');
    mocks.saveAgentState.mockReturnValue(Effect.succeed(undefined));
    mocks.readWorkspacePlanSync.mockReturnValue(planDoc([planItem('workspace-b95lw')]));
  });

  it('honors an operator-configured roles.work.effort instead of the high default', async () => {
    mocks.loadConfigSync.mockReturnValue({ config: { roles: { work: { effort: 'xhigh' } } } });

    await Effect.runPromise(spawnInspectAgent({
      projectKey: 'overdeck',
      projectPath: '/repo',
      issueId: 'PAN-1613',
      itemId: 'workspace-b95lw',
      workspace: '/workspace',
    }));

    expect(mocks.generateLauncherScriptSync).toHaveBeenCalledWith(expect.objectContaining({
      extraArgs: '--effort xhigh',
    }));
  });
});

describe('onInspectComplete verdict delivery (PAN-3078)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentHead.mockReturnValue(Effect.succeed('fedcba9876543210'));
    mocks.deliverAgentMessage.mockResolvedValue({ ok: true, path: 'supervisor' });
  });

  it('delivers a passed verdict to the work agent naming the item', async () => {
    await Effect.runPromise(onInspectComplete('overdeck', 'PAN-1613', 'workspace-b95lw', 'passed', '/workspace'));

    expect(mocks.deliverAgentMessage).toHaveBeenCalledTimes(1);
    const [agentId, message, caller] = mocks.deliverAgentMessage.mock.calls[0];
    expect(agentId).toBe('agent-pan-1613');
    expect(message).toContain('workspace-b95lw');
    expect(message).toContain('PASSED');
    expect(message).toContain('continue');
    expect(caller).toBe('inspect-verdict');
  });

  it('delivers a failed verdict carrying the blocking finding', async () => {
    await Effect.runPromise(onInspectComplete(
      'overdeck', 'PAN-1613', 'workspace-b95lw', 'failed', '/workspace',
      'imports ChatContext.tsx which the PRD prohibits',
    ));

    expect(mocks.deliverAgentMessage).toHaveBeenCalledTimes(1);
    const [agentId, message] = mocks.deliverAgentMessage.mock.calls[0];
    expect(agentId).toBe('agent-pan-1613');
    expect(message).toContain('workspace-b95lw');
    expect(message).toContain('BLOCKED');
    expect(message).toContain('imports ChatContext.tsx which the PRD prohibits');
    // A blocked item saves no checkpoint.
    expect(mocks.getCurrentHead).not.toHaveBeenCalled();
  });

  it('resumes a parked agent through an injected delivery port', async () => {
    // Integration-style: the waiting party is represented by a fake port; the
    // verdict arriving through it is what un-parks the agent.
    const received: string[] = [];
    const deliver = vi.fn(async (_id: string, message: string) => {
      received.push(message);
      return { ok: true, path: 'supervisor' as const };
    });

    await Effect.runPromise(onInspectComplete(
      'overdeck', 'PAN-1613', 'workspace-b95lw', 'passed', '/workspace', undefined, { deliver },
    ));

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(mocks.deliverAgentMessage).not.toHaveBeenCalled();
    expect(received[0]).toContain('workspace-b95lw');
  });

  it('logs at error level when delivery throws instead of swallowing it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.deliverAgentMessage.mockRejectedValue(new Error('MessageDeliveryFailed: no live session'));

    await expect(Effect.runPromise(
      onInspectComplete('overdeck', 'PAN-1613', 'workspace-b95lw', 'passed', '/workspace'),
    )).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FAILED to deliver passed verdict for PAN-1613 item workspace-b95lw'));
    errorSpy.mockRestore();
  });

  it('logs at error level when delivery reports ok=false', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.deliverAgentMessage.mockResolvedValue({ ok: false, path: 'tmux', failure: 'pane dead' });

    await Effect.runPromise(onInspectComplete('overdeck', 'PAN-1613', 'workspace-b95lw', 'failed', '/workspace'));

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('pane dead'));
    errorSpy.mockRestore();
  });

  // PAN-3743 stall hardening: a lost verdict deadlocks the work agent, so a
  // delivery failure must reach the operator via the same needs-you surface
  // the review-verdict path uses (PAN-2228) — not only the console.
  it('surfaces needs-you when delivery reports ok=false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.deliverAgentMessage.mockResolvedValue({ ok: false, path: 'tmux', failure: 'pane dead' });

    await Effect.runPromise(onInspectComplete('overdeck', 'PAN-1613', 'workspace-b95lw', 'failed', '/workspace'));

    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledTimes(1);
    const [issueId, message, opts] = mocks.surfaceIssueFeedbackNeedsYou.mock.calls[0];
    expect(issueId).toBe('PAN-1613');
    expect(message).toContain('workspace-b95lw');
    expect(message).toContain('agent-pan-1613');
    expect(message).toContain('pane dead');
    expect(opts).toEqual({ specialist: 'inspect-agent' });
  });

  it('surfaces needs-you when delivery throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.deliverAgentMessage.mockRejectedValue(
      new Error('PTY supervisor delivery failed (socket-missing)'),
    );

    await Effect.runPromise(onInspectComplete('overdeck', 'PAN-1613', 'workspace-b95lw', 'passed', '/workspace'));

    expect(mocks.surfaceIssueFeedbackNeedsYou).toHaveBeenCalledTimes(1);
    const [issueId, message, opts] = mocks.surfaceIssueFeedbackNeedsYou.mock.calls[0];
    expect(issueId).toBe('PAN-1613');
    expect(message).toContain('socket-missing');
    expect(opts).toEqual({ specialist: 'inspect-agent' });
  });

  it('still logs when the needs-you surface itself fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.deliverAgentMessage.mockRejectedValue(new Error('socket-missing'));
    mocks.surfaceIssueFeedbackNeedsYou.mockRejectedValue(new Error('db locked'));

    await expect(Effect.runPromise(
      onInspectComplete('overdeck', 'PAN-1613', 'workspace-b95lw', 'passed', '/workspace'),
    )).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FAILED to deliver passed verdict'));
    errorSpy.mockRestore();
  });
});

function planItem(id: string) {
  return {
    id,
    title: 'Inspect routing task',
    status: 'pending',
    metadata: { requiresInspection: false },
    items: [{ id: `${id}-ac`, title: 'routes through supervisor', status: 'pending' }],
  };
}

function planDoc(items: ReturnType<typeof planItem>[]) {
  return {
    xBRIEFInfo: {
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
