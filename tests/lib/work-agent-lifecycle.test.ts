import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

import {
  getAgentDir,
  saveAgentRuntimeState,
  saveAgentState,
  saveSessionId,
} from '../../src/lib/agents.js';
import { getWorkAgentLifecycleState } from '../../src/lib/work-agent-lifecycle.js';
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

    saveAgentState({
      id: agentId,
      issueId: 'PAN-692',
      workspace,
      runtime: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    saveSessionId(agentId, 'session-123');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(false);
    const lifecycle = getWorkAgentLifecycleState(agentId);

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

    saveAgentState({
      id: agentId,
      issueId: 'PAN-692',
      workspace,
      runtime: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(false);
    const lifecycle = getWorkAgentLifecycleState(agentId);

    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.recommendedAction).toBe('start');

    sessionExistsSpy.mockRestore();
  });

  it('reports running agent as non-resumable and non-startable', () => {
    const agentId = getUniqueAgentId('running');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentState({
      id: agentId,
      issueId: 'PAN-692',
      workspace,
      runtime: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'active',
      lastActivity: new Date().toISOString(),
    });
    saveSessionId(agentId, 'session-running');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(true);
    const lifecycle = getWorkAgentLifecycleState(agentId);

    expect(lifecycle.hasLiveTmuxSession).toBe(true);
    expect(lifecycle.canStartFresh).toBe(false);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.recommendedAction).toBe('none');

    sessionExistsSpy.mockRestore();
  });

  it('allows fresh start when agent state is missing and no live session exists', () => {
    const agentId = getUniqueAgentId('missing-state');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(false);
    const lifecycle = getWorkAgentLifecycleState(agentId);

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

    saveAgentState({
      id: agentId,
      issueId: 'PAN-704',
      workspace,
      runtime: 'claude',
      model: 'pending-container-start',
      status: 'starting',
      startedAt: new Date().toISOString(),
      phase: 'implementation',
    });

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(false);
    const lifecycle = getWorkAgentLifecycleState(agentId);

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

    saveAgentState({
      id: agentId,
      issueId: 'PAN-704',
      workspace,
      runtime: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });
    saveSessionId(agentId, 'session-ghost');

    const sessionExistsSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(false);
    const lifecycle = getWorkAgentLifecycleState(agentId);

    expect(lifecycle.hasWorkspace).toBe(false);
    expect(lifecycle.isOrphaned).toBe(true);
    expect(lifecycle.canStartFresh).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(lifecycle.canResetSession).toBe(false);
    expect(lifecycle.reason).toContain('stale/orphaned');

    sessionExistsSpy.mockRestore();
  });
});
