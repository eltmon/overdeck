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
});
