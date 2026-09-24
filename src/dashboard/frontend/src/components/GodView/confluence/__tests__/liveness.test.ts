import type { AgentSnapshot, BackendPane } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';
import { isClaimedLiveStatus, observedLiveAgentIds, withObservedLiveness } from '../liveness';

function agent(id: string, status: AgentSnapshot['status'], extra: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return { id, issueId: 'PAN-1', status, role: 'work', ...extra } as AgentSnapshot;
}

function pane(id: string, extra: Partial<BackendPane> = {}): BackendPane {
  return { id, role: 'work', harness: 'claude-code', model: 'unknown', state: 'working', ...extra };
}

describe('God View backend-observed liveness (PAN-3540)', () => {
  it('matches a pane by agent id, pane id, or terminal id, and ignores exited panes', () => {
    const agents = [
      agent('by-agent-id', 'running'),
      agent('by-pane-id', 'running'),
      agent('by-terminal-id', 'running'),
      agent('exited', 'running'),
      agent('phantom', 'running'),
    ];
    const live = observedLiveAgentIds(agents, {
      'w1:p1': pane('w1:p1', { agentId: 'by-agent-id' }),
      'by-pane-id': pane('by-pane-id'),
      'w1:p3': pane('w1:p3', { terminalId: 'by-terminal-id' }),
      'w1:p4': pane('w1:p4', { agentId: 'exited', state: 'exited' }),
    });
    expect([...live].sort()).toEqual(['by-agent-id', 'by-pane-id', 'by-terminal-id']);
  });

  it('falls back to the pane issue and role, like the stopped-agents banner', () => {
    const live = observedLiveAgentIds(
      [agent('agent-pan-2-review', 'running', { issueId: 'PAN-2', role: 'review' })],
      { 'w1:p1': pane('w1:p1', { issue: 'pan-2', role: 'review' }) },
    );
    expect(live.has('agent-pan-2-review')).toBe(true);
  });

  it('rewrites an unhosted live claim to stopped and leaves every other row alone', () => {
    const rows = withObservedLiveness([
      agent('hosted', 'running'),
      agent('phantom-running', 'running'),
      agent('phantom-warning', 'warning'),
      agent('crashed', 'error'),
      agent('stopped', 'stopped'),
    ], { 'w1:p1': pane('w1:p1', { agentId: 'hosted' }) });
    expect(rows.map((row) => `${row.id}:${row.status}`)).toEqual([
      'hosted:running',
      'phantom-running:stopped',
      'phantom-warning:stopped',
      'crashed:error',
      'stopped:stopped',
    ]);
    expect(rows.filter((row) => isClaimedLiveStatus(row.status)).map((row) => row.id)).toEqual(['hosted']);
  });

  it('treats a missing inventory as no observed panes', () => {
    expect(withObservedLiveness([agent('a', 'running')], undefined)[0]?.status).toBe('stopped');
  });
});
