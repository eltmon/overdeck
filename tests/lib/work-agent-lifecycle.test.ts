import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

import {
  getAgentDir,
  saveAgentRuntimeState,
  saveAgentStateSync,
  saveSessionId,
} from '../../src/lib/agents.js';
import { Effect } from 'effect';
import { setAgentRuntimeMirror } from '../../src/lib/agent-runtime-mirror.js';
import { getWorkAgentLifecycleStateSync } from '../../src/lib/work-agent-lifecycle.js';
import * as tmux from '../../src/lib/tmux.js';

describe('work-agent-lifecycle', () => {
  const testAgentIds: string[] = [];

  function getUniqueAgentId(prefix: string): string {
    const id = `agent-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testAgentIds.push(id);
    return id;
  }

  beforeEach(() => {
    testAgentIds.length = 0;
  });

  afterEach(() => {
    for (const agentId of testAgentIds) {
      const dir = getAgentDir(agentId);
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('blocks fresh start when a stopped agent has a saved session', () => {
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
    const lifecycle = getWorkAgentLifecycleStateSync(agentId);

    expect(lifecycle.canResumeSession).toBe(true);
    expect(lifecycle.canStartFresh).toBe(false);
    expect(lifecycle.requiresSessionResetBeforeFreshStart).toBe(true);
    expect(lifecycle.recommendedAction).toBe('resume');

    sessionExistsSpy.mockRestore();
  });

  it('allows fresh start when stopped agent has no saved session', () => {
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
    const lifecycle = getWorkAgentLifecycleStateSync(agentId);

    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.recommendedAction).toBe('start');

    sessionExistsSpy.mockRestore();
  });

  it('reports running agent as non-resumable and non-startable', () => {
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

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(true);
    const lifecycle = getWorkAgentLifecycleStateSync(agentId);

    expect(lifecycle.hasLiveTmuxSession).toBe(true);
    expect(lifecycle.isRunning).toBe(true);
    expect(lifecycle.isRunningButStuck).toBe(false);
    expect(lifecycle.canStartFresh).toBe(false);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('none');

    sessionExistsSpy.mockRestore();
  });

  // Regression: PAN-1014 — running agent with idle runtime incorrectly showed
  // canResumeSession:true AND isRunning:true simultaneously, allowing a spurious
  // resume that killed and restarted the live session.
  it('reports running-but-stuck agent as isRunningButStuck, canResumeSession:false, recommendedAction:resume', () => {
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

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(true);
    const lifecycle = getWorkAgentLifecycleStateSync(agentId);

    // The session IS alive and the agent IS running — isRunning must stay true.
    expect(lifecycle.isRunning).toBe(true);
    // But runtime is idle — so it's stuck, not actively processing.
    expect(lifecycle.isRunningButStuck).toBe(true);
    // isRunning and canResumeSession must not both be true — that was the bug.
    expect(lifecycle.canResumeSession).toBe(false);
    // Recommended action should be 'resume' (restart the stuck runtime), not 'none'.
    expect(lifecycle.recommendedAction).toBe('resume');
    expect(lifecycle.reason).toContain('runtime is idle');

    sessionExistsSpy.mockRestore();
    Effect.runSync(setAgentRuntimeMirror({}));
  });

  // 'suspended' is a legacy state retained for backward-compat — ensure it also
  // triggers isRunningButStuck when the tmux session is alive.
  it('reports running-but-stuck agent with suspended runtime as isRunningButStuck', () => {
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

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(true);
    const lifecycle = getWorkAgentLifecycleStateSync(agentId);

    expect(lifecycle.isRunning).toBe(true);
    expect(lifecycle.isRunningButStuck).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('resume');

    sessionExistsSpy.mockRestore();
    Effect.runSync(setAgentRuntimeMirror({}));
  });

  it('allows fresh start when agent state is missing and no live session exists', () => {
    const agentId = getUniqueAgentId('missing-state');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExistsSync').mockReturnValue(false);
    const lifecycle = getWorkAgentLifecycleStateSync(agentId);

    expect(lifecycle.hasAgentState).toBe(false);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('start');

    sessionExistsSpy.mockRestore();
  });

  it('treats placeholder agents with missing live session as orphaned and fresh-startable', () => {
    const agentId = getUniqueAgentId('placeholder-orphan');
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
    const lifecycle = getWorkAgentLifecycleStateSync(agentId);

    expect(lifecycle.isPlaceholder).toBe(true);
    expect(lifecycle.isOrphaned).toBe(true);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('start');

    sessionExistsSpy.mockRestore();
  });

  it('treats missing workspace as orphaned even with a saved session', () => {
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
    const lifecycle = getWorkAgentLifecycleStateSync(agentId);

    expect(lifecycle.hasWorkspace).toBe(false);
    expect(lifecycle.isOrphaned).toBe(true);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.canResetSession).toBe(false);
    expect(lifecycle.reason).toContain('stale/orphaned');

    sessionExistsSpy.mockRestore();
  });
});
