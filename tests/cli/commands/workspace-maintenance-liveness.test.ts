import { describe, expect, it } from 'vitest';

import type { AgentState } from '../../../src/lib/agents.js';
import type { HerdrLivenessProbe } from '../../../src/lib/terminal-backends/herdr.js';
import { findLiveAgentInWorkspace } from '../../../src/cli/commands/workspace-maintenance.js';

const WORKSPACE = '/repo/workspaces/feature-pan-4109';

function agent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-4109',
    issueId: 'PAN-4109',
    workspace: WORKSPACE,
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-5',
    status: 'running',
    startedAt: '2026-09-24T00:00:00.000Z',
    ...overrides,
  } as AgentState;
}

/** Fake Herdr backend: answers the liveness probe; no tmux is consulted for live or indeterminate answers. */
function herdr(answer: HerdrLivenessProbe['kind']) {
  return {
    backend: 'herdr' as const,
    probeHerdr: async (): Promise<HerdrLivenessProbe> => ({ kind: answer } as HerdrLivenessProbe),
    queryTmuxSession: async () => 'missing' as const,
  };
}

describe('findLiveAgentInWorkspace (#4109)', () => {
  it('finds a live Herdr agent, which has no tmux session', async () => {
    const found = await findLiveAgentInWorkspace(WORKSPACE, [agent()], herdr('alive'));
    expect(found?.id).toBe('agent-pan-4109');
  });

  it('ignores an agent whose pane is confirmed gone', async () => {
    expect(await findLiveAgentInWorkspace(WORKSPACE, [agent()], herdr('absent'))).toBeUndefined();
  });

  it('treats an unanswered probe as live, so the guard blocks', async () => {
    const found = await findLiveAgentInWorkspace(WORKSPACE, [agent()], herdr('indeterminate'));
    expect(found?.id).toBe('agent-pan-4109');
  });

  it('ignores agents in other workspaces and stopped rows', async () => {
    const agents = [agent({ workspace: '/elsewhere' }), agent({ id: 'agent-stopped', status: 'stopped' })];
    expect(await findLiveAgentInWorkspace(WORKSPACE, agents, herdr('alive'))).toBeUndefined();
  });
});
