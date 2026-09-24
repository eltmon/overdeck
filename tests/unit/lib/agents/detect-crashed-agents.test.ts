/**
 * #4105: crash detection asks the backend-aware liveness oracle, not the
 * tmux-only `tmuxActive` flag. A live Herdr agent has no tmux session, so the
 * old filter listed every one of them as crashed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentState } from '../../../../src/lib/agents.js';

// The host's agent registry, as both the pre-fix (`listRunningAgentsSync`) and
// post-fix (`listAgentStates`) readers see it. Every row reads
// `tmuxActive: false`, as a Herdr agent always does.
const registry = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('../../../../src/lib/agents/queries.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listRunningAgentsSync: () => registry.rows,
  listAgentStates: () => registry.rows,
}));
import { detectCrashedAgents } from '../../../../src/lib/agents/recovery.js';
import type { HerdrLivenessProbe } from '../../../../src/lib/terminal-backends/herdr.js';

function agent(id: string, status: AgentState['status'] = 'running'): AgentState {
  return { id, issueId: 'PAN-4105', role: 'work', status, tmuxActive: false } as unknown as AgentState;
}

/** A fake Herdr backend: each agent id maps to the probe answer Herdr gives. */
function herdr(answers: Record<string, HerdrLivenessProbe['kind']>) {
  return {
    backend: 'herdr' as const,
    probeHerdr: async (id: string): Promise<HerdrLivenessProbe> => {
      const kind = answers[id] ?? 'absent';
      if (kind === 'alive') return { kind, paneId: 'w1:p1', state: 'working' } as unknown as HerdrLivenessProbe;
      if (kind === 'exited') return { kind, paneId: 'w1:p1' };
      if (kind === 'indeterminate') return { kind, reason: 'socket did not answer' };
      return { kind: 'absent' };
    },
    // No legacy tmux session behind a Herdr `absent`.
    queryTmuxSession: async () => 'missing' as const,
  };
}

describe('detectCrashedAgents', () => {
  beforeEach(() => {
    registry.rows = [];
  });

  it('does not report a live Herdr agent from the registry as crashed', async () => {
    registry.rows = [agent('agent-pan-4105')];
    const crashed = await detectCrashedAgents(undefined, herdr({ 'agent-pan-4105': 'alive' }));
    expect(crashed).toEqual([]);
  });

  it('reports a running agent whose Herdr pane exited or vanished as crashed', async () => {
    const crashed = await detectCrashedAgents(
      [agent('agent-pan-1'), agent('agent-pan-2')],
      herdr({ 'agent-pan-1': 'exited', 'agent-pan-2': 'absent' }),
    );
    expect(crashed.map((a) => a.id)).toEqual(['agent-pan-1', 'agent-pan-2']);
  });

  it('does not report an agent as crashed when the backend cannot answer', async () => {
    registry.rows = [agent('agent-pan-4105')];
    const crashed = await detectCrashedAgents(undefined, herdr({ 'agent-pan-4105': 'indeterminate' }));
    expect(crashed).toEqual([]);
  });

  it('ignores agents whose stored status is not running', async () => {
    const crashed = await detectCrashedAgents([agent('agent-pan-9', 'stopped')], herdr({}));
    expect(crashed).toEqual([]);
  });
});
