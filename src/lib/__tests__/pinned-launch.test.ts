import { describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../agents/agent-state.js';
import { parsePinnedAgentLaunch } from '../agents/pinned-launch.js';
import { reconcileLiveWorkSpawnPlaceholder } from '../agents/placeholder-reconciliation.js';

describe('parsePinnedAgentLaunch', () => {
  it('recovers a Claude Code model and pinned session', () => {
    expect(parsePinnedAgentLaunch(
      "exec node '/opt/overdeck/dist/pty-supervisor.js' claude --effort high --model 'gpt-5.6-sol' --session-id 'session-1'",
      'session-1\n',
    )).toEqual({
      sessionId: 'session-1',
      model: 'gpt-5.6-sol',
      harness: 'claude-code',
    });
  });

  it('recovers Pi and Codex launcher models', () => {
    expect(parsePinnedAgentLaunch(
      "exec omp --mode rpc --model 'claude-sonnet-5' --session-dir '/tmp/session'",
      'pi-session',
    )).toEqual({
      sessionId: 'pi-session',
      model: 'claude-sonnet-5',
      harness: 'ohmypi',
    });
    expect(parsePinnedAgentLaunch(
      "exec node '/opt/overdeck/dist/codex-app-server-host.js' --model 'gpt-5.6-sol'",
      'codex-thread',
    )).toEqual({
      sessionId: 'codex-thread',
      model: 'gpt-5.6-sol',
      harness: 'codex',
    });
  });

  it('rejects launchers without both a real model and session id', () => {
    expect(parsePinnedAgentLaunch('exec claude --model pending-work-spawn', '')).toBeNull();
    expect(parsePinnedAgentLaunch('exec sleep 60', 'session-1')).toBeNull();
  });
});

describe('reconcileLiveWorkSpawnPlaceholder', () => {
  it('restores the real launch identity and running status', async () => {
    const state: AgentState = {
      id: 'agent-pan-2898',
      issueId: 'PAN-2898',
      workspace: '/tmp/workspace',
      role: 'work',
      model: 'pending-work-spawn',
      status: 'starting',
      startedAt: '2026-07-19T02:43:53.570Z',
    };
    const notify = vi.fn();
    const saveState = vi.fn(async () => undefined);
    const markRunning = vi.fn((current: AgentState) => {
      current.status = 'running';
      return current;
    });

    await expect(reconcileLiveWorkSpawnPlaceholder(state, notify, {
      readPinnedLaunch: () => ({
        sessionId: 'session-1',
        model: 'gpt-5.6-sol',
        harness: 'claude-code',
      }),
      markRunning,
      saveState,
      logDeacon: vi.fn(),
      logAgent: vi.fn(),
    })).resolves.toBe(
      'Reconciled agent-pan-2898 placeholder to running (claude-code/gpt-5.6-sol)',
    );

    expect(state).toMatchObject({
      status: 'running',
      model: 'gpt-5.6-sol',
      harness: 'claude-code',
      sessionId: 'session-1',
    });
    expect(saveState).toHaveBeenCalledWith(state);
    expect(notify).toHaveBeenCalledWith(state, 'starting', true);
  });

  it('leaves non-placeholder or unpinned state unchanged', async () => {
    const running = {
      id: 'agent-pan-2898',
      issueId: 'PAN-2898',
      workspace: '/tmp/workspace',
      role: 'work',
      model: 'gpt-5.6-sol',
      status: 'running',
      startedAt: '2026-07-19T02:43:53.570Z',
    } as AgentState;
    const saveState = vi.fn(async () => undefined);
    const deps = {
      readPinnedLaunch: vi.fn(() => null),
      markRunning: vi.fn((state: AgentState) => state),
      saveState,
      logDeacon: vi.fn(),
      logAgent: vi.fn(),
    };

    await expect(reconcileLiveWorkSpawnPlaceholder(running, vi.fn(), deps)).resolves.toBeNull();
    expect(deps.readPinnedLaunch).not.toHaveBeenCalled();
    expect(saveState).not.toHaveBeenCalled();
  });
});
