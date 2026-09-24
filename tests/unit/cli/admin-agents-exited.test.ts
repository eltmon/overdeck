/**
 * PAN-3848 (W26, FR-21): `pan admin agents exited <agentId> --code <n>` writes
 * `status: stopped` through the agent-state door when a reviewer's launcher
 * reports the process exit — no patrol infers exit from a missing tmux
 * session. The operator-stop gate is not engaged (cause 'system' keeps
 * `stoppedByUser` unset, PAN-3324).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentsExitedCommand } from '../../../src/cli/commands/admin/agents-exited.js';
import * as agentStateModule from '../../../src/lib/agents/agent-state.js';
import type { AgentState } from '../../../src/lib/agents/agent-state.js';

// PAN-3917: there is no separate "agents row" (the SQLite mirror is gone) —
// saveAgentStateSync writes state.json only. Spy on the real implementation
// so the fixture's own state.json reads/writes still happen for real.
const saveAgentStateSyncSpy = vi.spyOn(agentStateModule, 'saveAgentStateSync');

const AGENT_ID = 'agent-pan-3848-review-security';

function runningState(): AgentState {
  return {
    id: AGENT_ID,
    issueId: 'PAN-3848',
    role: 'review',
    status: 'running',
    harness: 'claude-code',
    model: 'claude-opus-5',
    workspace: '/tmp/workspace',
    startedAt: '2026-09-17T00:00:00.000Z',
    lastActivity: '2026-09-17T00:00:00.000Z',
  } as AgentState;
}

describe('pan admin agents exited (PAN-3848 W26)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-agents-exited-'));
    process.env.OVERDECK_HOME = home;
    saveAgentStateSyncSpy.mockClear();

    mkdirSync(join(home, 'agents', AGENT_ID), { recursive: true });
    writeFileSync(
      join(home, 'agents', AGENT_ID, 'state.json'),
      JSON.stringify(runningState(), null, 2),
    );
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  function readStateJson(): AgentState {
    return JSON.parse(
      readFileSync(join(home, 'agents', AGENT_ID, 'state.json'), 'utf8'),
    ) as AgentState;
  }

  it('marks the agent stopped with cause system: state.json reads stopped and stoppedByUser stays unset', async () => {
    await agentsExitedCommand(AGENT_ID, { code: '0' });

    const state = readStateJson();
    expect(state.status).toBe('stopped');
    expect(state.stoppedByUser).toBeUndefined();
    expect(state.stoppedAt).toBeDefined();
    // The write door is used exactly once — no patrol sweep infers this.
    expect(saveAgentStateSyncSpy).toHaveBeenCalledTimes(1);

    const lifecycle = readFileSync(join(home, 'agents', AGENT_ID, 'lifecycle.log'), 'utf8');
    expect(lifecycle).toContain('code 0');
    expect(lifecycle).toContain('launcher-reported');
  });

  it('records a non-zero exit code in lifecycle.log', async () => {
    await agentsExitedCommand(AGENT_ID, { code: '124' });

    expect(readStateJson().status).toBe('stopped');
    const lifecycle = readFileSync(join(home, 'agents', AGENT_ID, 'lifecycle.log'), 'utf8');
    expect(lifecycle).toContain('code 124');
  });

  it('is a no-op for an already-stopped agent and for a missing state.json', async () => {
    const stopped = { ...runningState(), status: 'stopped' as const };
    writeFileSync(join(home, 'agents', AGENT_ID, 'state.json'), JSON.stringify(stopped, null, 2));
    await agentsExitedCommand(AGENT_ID, { code: '0' });
    expect(saveAgentStateSyncSpy).not.toHaveBeenCalled();

    await expect(agentsExitedCommand('agent-pan-9999-review-security', { code: '1' })).resolves.toBeUndefined();
  });
});
