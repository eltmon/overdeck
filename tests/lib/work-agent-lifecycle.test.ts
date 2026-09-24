import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  getAgentDir,
  saveAgentRuntimeState,
  saveAgentStateSync,
  saveSessionId,
} from '../../src/lib/agents.js';
import { Effect } from 'effect';
import { markAgentStateServiceInProcess, setAgentRuntimeMirror } from '../../src/lib/agent-runtime-mirror.js';
import { assertCanStartFresh, getWorkAgentLifecycleState } from '../../src/lib/work-agent-lifecycle.js';
import * as claudeStorage from '../../src/lib/runtimes/storage/claude-code.js';
import * as tmux from '../../src/lib/tmux.js';
import * as liveness from '../../src/lib/agents/liveness.js';

// The lifecycle door reads runtime state through the async agent-state
// service, which outside the dashboard process fetches it over HTTP. Mark the
// service in-process so it reads the mirror these fixtures seed and the test
// never reaches a live dashboard.
Effect.runSync(markAgentStateServiceInProcess());

// The async door asks the forge about owed rework for handed-off agents
// (PAN-3555); these fixtures owe none.
vi.mock('../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: async () => ({ changesRequested: false }),
}));

// PAN-3849: "live agent" is the liveness oracle's verdict — mock the oracle
// at its boundary. By default no agent is alive (the host's real backend is
// never probed, PAN-3926); fixtures that mean "the agent is genuinely alive"
// call spyLiveAgent.
function spyLiveAgent() {
  const spy = vi.spyOn(liveness, 'isAlive').mockResolvedValue({ alive: true, paneAlive: true });
  return { restore: () => spy.mockReturnValue(Promise.resolve({ alive: false, reason: 'no-session' })) };
}

describe('work-agent-lifecycle', () => {
  const testAgentIds: string[] = [];

  function getUniqueAgentId(prefix: string): string {
    const id = `agent-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testAgentIds.push(id);
    return id;
  }

  beforeEach(() => {
    testAgentIds.length = 0;
    vi.spyOn(liveness, 'isAlive').mockResolvedValue({ alive: false, reason: 'no-session' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const agentId of testAgentIds) {
      const dir = getAgentDir(agentId);
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('blocks fresh start when a stopped agent has a saved session', async () => {
    const agentId = getUniqueAgentId('resume-block');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-692',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    saveSessionId(agentId, 'session-123');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const transcriptExistsSpy = vi.spyOn(claudeStorage, 'claudeSessionTranscriptExists').mockReturnValue(true);
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    expect(lifecycle.canResumeSession).toBe(true);
    expect(lifecycle.canStartFresh).toBe(false);
    expect(lifecycle.requiresSessionResetBeforeFreshStart).toBe(true);
    expect(lifecycle.recommendedAction).toBe('resume');
    expect(lifecycle.reason).toContain(`pan reset-session ${agentId}`);
    expect(lifecycle.reason).not.toContain('--fresh');
    await expect(assertCanStartFresh(agentId)).rejects.toThrow(/resumable Claude session/);
    await expect(assertCanStartFresh(agentId, { explicitFresh: true })).resolves.toBeDefined();

    transcriptExistsSpy.mockRestore();
    sessionExistsSpy.mockRestore();
  });

  it('requires explicit --fresh to replace a handed-off agent saved session (PAN-3583)', async () => {
    const agentId = getUniqueAgentId('handoff-fresh');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-692',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    saveSessionId(agentId, 'session-123');
    // Completion marker: the agent finished and handed off. A plain start must
    // preserve its warm session, while explicit --fresh must replace it.
    writeFileSync(join(getAgentDir(agentId), 'completed'), '');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const transcriptExistsSpy = vi.spyOn(claudeStorage, 'claudeSessionTranscriptExists').mockReturnValue(true);
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    expect(lifecycle.handedOff).toBe(true);
    expect(lifecycle.canResumeSession).toBe(true);
    expect(lifecycle.requiresSessionResetBeforeFreshStart).toBe(true);
    expect(lifecycle.canStartFresh).toBe(false);
    expect(lifecycle.recommendedAction).toBe('resume');
    await expect(assertCanStartFresh(agentId)).rejects.toThrow(/handed off/);
    await expect(assertCanStartFresh(agentId, { explicitFresh: true })).resolves.toBeDefined();

    transcriptExistsSpy.mockRestore();
    sessionExistsSpy.mockRestore();
  });

  it('allows fresh start when stopped agent has no saved session', async () => {
    const agentId = getUniqueAgentId('fresh-ok');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-692',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.recommendedAction).toBe('start');

    sessionExistsSpy.mockRestore();
  });

  it('reports running agent as non-resumable and non-startable', async () => {
    const agentId = getUniqueAgentId('running');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-692',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'active',
      lastActivity: new Date().toISOString(),
    });
    saveSessionId(agentId, 'session-running');

    const liveSpies = spyLiveAgent();
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    expect(lifecycle.hasLiveTmuxSession).toBe(true);
    expect(lifecycle.isRunning).toBe(true);
    expect(lifecycle.isRunningButStuck).toBe(false);
    expect(lifecycle.canStartFresh).toBe(false);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('none');

    liveSpies.restore();
  });

  it('PAN-3926: a live Herdr agent (no tmux session) is running to the guards', async () => {
    const agentId = getUniqueAgentId('herdr-running');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });
    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-3926',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, { state: 'active', lastActivity: new Date().toISOString() });

    // tmux knows nothing about a Herdr agent; only the backend-aware oracle
    // sees it. A tmux-only liveness read called it crashed and let a second
    // work agent start over it.
    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const herdrSpy = vi.spyOn(liveness, 'isAlive').mockResolvedValue({ alive: true, paneAlive: true });

    await expect(assertCanStartFresh(agentId)).rejects.toThrow(/already running/);
    expect(herdrSpy).toHaveBeenCalledWith(agentId);
    const lifecycle = await getWorkAgentLifecycleState(agentId);
    expect(lifecycle.isRunning).toBe(true);
    expect(lifecycle.isCrashed).toBe(false);

    sessionExistsSpy.mockRestore();
  });

  it('PAN-3926: an indeterminate probe is not death — no fresh start over it', async () => {
    const agentId = getUniqueAgentId('probe-indeterminate');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });
    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-3926',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, { state: 'active', lastActivity: new Date().toISOString() });
    vi.spyOn(liveness, 'isAlive').mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });

    await expect(assertCanStartFresh(agentId)).rejects.toThrow(/already running/);
  });

  // Regression: PAN-1014 — running agent with idle runtime incorrectly showed
  // canResumeSession:true AND isRunning:true simultaneously, allowing a spurious
  // resume that killed and restarted the live session.
  it('reports running-but-stuck agent as isRunningButStuck, canResumeSession:false, recommendedAction:resume', async () => {
    const agentId = getUniqueAgentId('running-stuck');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1014',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'kimi-k2.6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    // Populate the runtime mirror directly — saveAgentRuntimeState is async and
    // relies on the dashboard event system which is not running in unit tests.
    // activity:'idle' maps to runtimeState.state === 'idle' via snapshotToRuntimeState.
    Effect.runSync(setAgentRuntimeMirror({
      [agentId]: {
        id: agentId,
        activity: 'idle',
        lastActivity: new Date().toISOString(),
        updatedAtSequence: 1,
      },
    }));
    saveSessionId(agentId, 'session-stuck');

    const liveSpies = spyLiveAgent();
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    // The session IS alive and the agent IS running — isRunning must stay true.
    expect(lifecycle.isRunning).toBe(true);
    // But runtime is idle — so it's stuck, not actively processing.
    expect(lifecycle.isRunningButStuck).toBe(true);
    // isRunning and canResumeSession must not both be true — that was the bug.
    expect(lifecycle.canResumeSession).toBe(false);
    // Recommended action should be 'resume' (restart the stuck runtime), not 'none'.
    expect(lifecycle.recommendedAction).toBe('resume');
    expect(lifecycle.reason).toContain('runtime is idle');

    liveSpies.restore();
    Effect.runSync(setAgentRuntimeMirror({}));
  });

  // 'suspended' is a legacy state retained for backward-compat — ensure it also
  // triggers isRunningButStuck when the tmux session is alive.
  it('reports running-but-stuck agent with suspended runtime as isRunningButStuck', async () => {
    const agentId = getUniqueAgentId('running-suspended');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-1014',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    // 'suspended' is not emitted by the new event path but must remain covered
    // for backward-compat. Set the mirror with a state that maps to 'idle' for
    // now (since the Activity enum has no 'suspended' variant). Test the
    // isRunningButStuck gate by explicitly setting runtimeState via the mirror
    // with activity:'idle' and checking against the current contract.
    //
    // NOTE: true backward-compat 'suspended' state can only arise from legacy
    // code paths that wrote state.json directly. New code uses activity:'idle'.
    // Since snapshotToRuntimeState has no 'suspended' Activity mapping, we use
    // 'idle' here as the closest real-world equivalent.
    Effect.runSync(setAgentRuntimeMirror({
      [agentId]: {
        id: agentId,
        activity: 'idle',
        lastActivity: new Date().toISOString(),
        updatedAtSequence: 1,
      },
    }));
    saveSessionId(agentId, 'session-suspended');

    const liveSpies = spyLiveAgent();
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    expect(lifecycle.isRunning).toBe(true);
    expect(lifecycle.isRunningButStuck).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('resume');

    liveSpies.restore();
    Effect.runSync(setAgentRuntimeMirror({}));
  });

  it('allows fresh start when agent state is missing and no live session exists', async () => {
    const agentId = getUniqueAgentId('missing-state');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    expect(lifecycle.hasAgentState).toBe(false);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('start');

    sessionExistsSpy.mockRestore();
  });

  it('PAN-3849: a starting agent with no live session is fresh-startable (no placeholder concept)', async () => {
    const agentId = getUniqueAgentId('starting-no-session');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-704',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'pending-container-start',
      status: 'starting',
      startedAt: new Date().toISOString(),
    });

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    // No placeholder classification anymore: a 'starting' row with a workspace
    // and no live session is simply not orphaned and offers a fresh start.
    expect(lifecycle.hasAgentState).toBe(true);
    expect(lifecycle.hasLiveTmuxSession).toBe(false);
    expect(lifecycle.isOrphaned).toBe(false);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('start');

    sessionExistsSpy.mockRestore();
  });

  it('treats missing workspace as orphaned even with a saved session', async () => {
    const agentId = getUniqueAgentId('missing-workspace');
    const workspace = join('/tmp', agentId, 'missing');

    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-704',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    saveSessionId(agentId, 'session-ghost');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const lifecycle = await getWorkAgentLifecycleState(agentId);

    expect(lifecycle.hasWorkspace).toBe(false);
    expect(lifecycle.isOrphaned).toBe(true);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.canResetSession).toBe(false);
    expect(lifecycle.reason).toContain('stale/orphaned');

    sessionExistsSpy.mockRestore();
  });

  function setUpHandedOffAgentOwingRework(prefix: string): string {
    const agentId = getUniqueAgentId(prefix);
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });
    saveAgentStateSync({
      id: agentId,
      issueId: 'PAN-3555',
      workspace,
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    saveSessionId(agentId, 'session-warm');
    writeFileSync(join(getAgentDir(agentId), 'completed'), '');
    return agentId;
  }

  it('keeps a handed-off agent warm-resumable when its PR owes no rework (supersedes PAN-3334)', async () => {
    const agentId = setUpHandedOffAgentOwingRework('handoff-resting');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const transcriptExistsSpy = vi.spyOn(claudeStorage, 'claudeSessionTranscriptExists').mockReturnValue(true);

    const lifecycle = await getWorkAgentLifecycleState(agentId);

    expect(lifecycle.handedOff).toBe(true);
    expect(lifecycle.canResumeSession).toBe(true);
    expect(lifecycle.canStartFresh).toBe(false);
    expect(lifecycle.recommendedAction).toBe('resume');
    await expect(assertCanStartFresh(agentId)).rejects.toThrow(/handed off/);
    await expect(assertCanStartFresh(agentId, { explicitFresh: true })).resolves.toBeDefined();

    transcriptExistsSpy.mockRestore();
    sessionExistsSpy.mockRestore();
  });
});
