import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;

describe('AgentState role persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    tempHome = mkdtempSync(join(tmpdir(), 'pan-agent-role-'));
    process.env.PANOPTICON_HOME = tempHome;
  });

  afterEach(() => {
    delete process.env.PANOPTICON_HOME;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('round-trips the optional role field through state.json', async () => {
    const { getAgentState, saveAgentState } = await import('../agents.js');

    saveAgentState({
      id: 'agent-pan-role',
      issueId: 'PAN-1048',
      workspace: '/tmp/workspace',
      runtime: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-4-6',
      status: 'running',
      startedAt: '2026-05-09T00:00:00.000Z',
    });

    const state = getAgentState('agent-pan-role');
    expect(state?.role).toBe('work');

    const rawState = JSON.parse(readFileSync(join(tempHome, 'agents', 'agent-pan-role', 'state.json'), 'utf-8'));
    expect(rawState.role).toBe('work');
  });
});
