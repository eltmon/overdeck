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

const mockGetOverdeckAgentStateSync = vi.hoisted(() => vi.fn());
const mockSaveOverdeckAgentStateSync = vi.hoisted(() => vi.fn());

vi.mock('../../../src/lib/overdeck/agent-state-sync.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/overdeck/agent-state-sync.js')>()),
  getOverdeckAgentStateSync: mockGetOverdeckAgentStateSync,
  saveOverdeckAgentStateSync: mockSaveOverdeckAgentStateSync,
}));

import { agentsExitedCommand } from '../../../src/cli/commands/admin/agents-exited.js';
import type { AgentState } from '../../../src/lib/agents/agent-state.js';

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
    mockGetOverdeckAgentStateSync.mockReset();
    mockSaveOverdeckAgentStateSync.mockReset();
    // No DB row in the fixture — the read falls through to state.json.
    mockGetOverdeckAgentStateSync.mockReturnValue(null);

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
    // The agents row is written through the same save (dashboard updates
    // without a patrol sweep).
    expect(mockSaveOverdeckAgentStateSync).toHaveBeenCalledTimes(1);

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
    expect(mockSaveOverdeckAgentStateSync).not.toHaveBeenCalled();

    await expect(agentsExitedCommand('agent-pan-9999-review-security', { code: '1' })).resolves.toBeUndefined();
  });
});
