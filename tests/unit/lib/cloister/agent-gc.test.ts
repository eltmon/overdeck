import { describe, expect, it, vi } from 'vitest';
import { pruneStoppedAgentsForIssue } from '../../../../src/lib/cloister/agent-gc.js';
import type { AgentState } from '../../../../src/lib/agents/agent-state.js';

const agent = (id: string, status: AgentState['status'], role: AgentState['role']): AgentState => ({
  id, issueId: 'PAN-2503', workspace: '/workspace', harness: 'codex', role, model: 'gpt-5.6', status, startedAt: '2026-07-10T00:00:00Z',
});

describe('PAN-2543 event-driven agent row GC', () => {
  it('prunes stopped rows for every role and preserves live/non-stopped rows', () => {
    const remove = vi.fn();
    const result = pruneStoppedAgentsForIssue('PAN-2503', [
      agent('agent-pan-2503', 'stopped', 'work'),
      agent('planning-pan-2503', 'stopped', 'plan'),
      agent('agent-pan-2503-review', 'running', 'review'),
      { ...agent('agent-pan-9999', 'stopped', 'work'), issueId: 'PAN-9999' },
    ], remove);

    expect(result).toEqual({ removed: ['agent-pan-2503', 'planning-pan-2503'], preserved: ['agent-pan-2503-review'] });
    expect(remove.mock.calls.map(call => call[0])).toEqual(result.removed);
  });
});
