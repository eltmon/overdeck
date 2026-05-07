/**
 * Gate predicate tests for POST /api/agents/:id/resume (PAN-1014).
 *
 * The resume route uses:
 *   if (!lifecycleBefore.canResumeSession && !lifecycleBefore.isRunningButStuck)
 *     → 409
 *
 * This is equivalent to: allow = canResumeSession || isRunningButStuck
 *
 * These tests verify the gate predicate against real lifecycle states,
 * covering the three scenarios the route must distinguish:
 *   1. Truly running agent — 409 (session alive, runtime active, no resume)
 *   2. Running-but-stuck agent — 200 (session alive, runtime idle, allow resume)
 *   3. Stopped agent with saved session — 200 (normal resume)
 *
 * The full HTTP Effect handler is not exercised here (requires a full server
 * stack). The critical logic is the predicate; lifecycle state is tested
 * independently in tests/lib/work-agent-lifecycle.test.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

import {
  getAgentDir,
  saveAgentState,
  saveSessionId,
} from '../../../../../src/lib/agents.js';
import { setAgentRuntimeMirror } from '../../../../../src/lib/agent-runtime-mirror.js';
import { getWorkAgentLifecycleState } from '../../../../../src/lib/work-agent-lifecycle.js';
import type { WorkAgentLifecycleState } from '../../../../../src/lib/work-agent-lifecycle.js';
import * as tmux from '../../../../../src/lib/tmux.js';

/** The resume route's gate predicate — extracted for contract testing. */
function resumeGateAllows(lifecycle: WorkAgentLifecycleState): boolean {
  return lifecycle.canResumeSession || lifecycle.isRunningButStuck;
}

const testAgentIds: string[] = [];

function makeAgentId(prefix: string): string {
  const id = `agent-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  testAgentIds.push(id);
  return id;
}

afterEach(() => {
  setAgentRuntimeMirror({});
  for (const id of testAgentIds) {
    const dir = getAgentDir(id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  testAgentIds.length = 0;
});

describe('resume route gate predicate', () => {
  it('returns 409 for a truly-running agent (active runtime, live session)', () => {
    // Scenario: agent is running and making progress — no resume needed.
    const agentId = makeAgentId('running-active');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentState({
      id: agentId,
      issueId: 'PAN-1014',
      workspace,
      runtime: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    setAgentRuntimeMirror({
      [agentId]: { id: agentId, activity: 'working', lastActivity: new Date().toISOString(), updatedAtSequence: 1 },
    });
    saveSessionId(agentId, 'session-active');

    const sessionSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(true);
    const lifecycle = getWorkAgentLifecycleState(agentId);

    // Gate must BLOCK — agent is genuinely running, isRunning:true, isRunningButStuck:false.
    expect(lifecycle.isRunning).toBe(true);
    expect(lifecycle.isRunningButStuck).toBe(false);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(resumeGateAllows(lifecycle)).toBe(false); // → 409

    sessionSpy.mockRestore();
  });

  it('returns 200 for a running-but-stuck agent (idle runtime, live session) — PAN-1014 regression', () => {
    // Scenario: agent has a live tmux session but the model stopped producing
    // output (e.g. model-not-found errors). Runtime fell to 'idle'.
    // The route should allow resume to restart the stuck runtime.
    const agentId = makeAgentId('running-stuck');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentState({
      id: agentId,
      issueId: 'PAN-1014',
      workspace,
      runtime: 'claude',
      model: 'kimi-k2.6',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    setAgentRuntimeMirror({
      [agentId]: { id: agentId, activity: 'idle', lastActivity: new Date().toISOString(), updatedAtSequence: 1 },
    });
    saveSessionId(agentId, 'session-stuck');

    const sessionSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(true);
    const lifecycle = getWorkAgentLifecycleState(agentId);

    // Gate must ALLOW — agent is running-but-stuck, isRunningButStuck:true.
    expect(lifecycle.isRunning).toBe(true);
    expect(lifecycle.isRunningButStuck).toBe(true);
    expect(lifecycle.canResumeSession).toBe(false); // not simultaneously true with isRunning
    expect(resumeGateAllows(lifecycle)).toBe(true); // → 200

    sessionSpy.mockRestore();
  });

  it('returns 200 for a stopped agent with a saved session (normal resume)', () => {
    // Scenario: agent was cleanly stopped, has a JSONL session to replay.
    const agentId = makeAgentId('stopped-resumable');
    const workspace = join('/tmp', agentId);
    mkdirSync(workspace, { recursive: true });

    saveAgentState({
      id: agentId,
      issueId: 'PAN-1014',
      workspace,
      runtime: 'claude',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      startedAt: new Date().toISOString(),
    });
    // No runtime mirror entry — runtime state is null → 'uninitialized'.
    // agentStatus='stopped' drives isStopped=true independently.
    saveSessionId(agentId, 'session-stopped');

    const sessionSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(false);
    const lifecycle = getWorkAgentLifecycleState(agentId);

    // Gate must ALLOW — canResumeSession:true (stopped + saved session).
    expect(lifecycle.isRunning).toBe(false);
    expect(lifecycle.isRunningButStuck).toBe(false);
    expect(lifecycle.canResumeSession).toBe(true);
    expect(resumeGateAllows(lifecycle)).toBe(true); // → 200

    sessionSpy.mockRestore();
  });

  it('returns 409 for an agent with no state and no saved session', () => {
    // Scenario: fresh agent that has never been started — nothing to resume.
    const agentId = makeAgentId('no-state');

    const sessionSpy = vi.spyOn(tmux, 'sessionExists').mockReturnValue(false);
    const lifecycle = getWorkAgentLifecycleState(agentId);

    expect(lifecycle.isRunning).toBe(false);
    expect(lifecycle.isRunningButStuck).toBe(false);
    expect(lifecycle.canResumeSession).toBe(false);
    expect(resumeGateAllows(lifecycle)).toBe(false); // → 409

    sessionSpy.mockRestore();
  });
});
