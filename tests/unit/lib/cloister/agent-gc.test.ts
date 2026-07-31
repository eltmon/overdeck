import { describe, expect, it, vi } from 'vitest';
import {
  pruneStoppedAgentsForIssue,
  pruneTerminalStoppedAgents,
} from '../../../../src/lib/cloister/agent-gc.js';
import { RETAINED_TRANSCRIPTS_PHASE } from '../../../../src/lib/overdeck/agents.js';
import type { AgentState } from '../../../../src/lib/agents/agent-state.js';

const agent = (id: string, status: AgentState['status'], role: AgentState['role']): AgentState => ({
  id, issueId: 'PAN-2503', workspace: '/workspace', harness: 'codex', role, model: 'gpt-5.6', status, startedAt: '2026-07-10T00:00:00Z',
});

describe('PAN-2543 event-driven agent row GC', () => {
  it('prunes stopped rows only after their transcript-preserving cleanup is complete', async () => {
    const removeRecord = vi.fn();
    const cleanStateDir = vi.fn(async () => ({
      removedFiles: 1,
      preservedTranscripts: 0,
      removedDir: true,
    }));
    const result = await pruneStoppedAgentsForIssue('PAN-2503', [
      agent('agent-pan-2503', 'stopped', 'work'),
      agent('planning-pan-2503', 'stopped', 'plan'),
      agent('agent-pan-2503-review', 'running', 'review'),
      { ...agent('agent-pan-9999', 'stopped', 'work'), issueId: 'PAN-9999' },
    ], {
      agentsDir: '/agents',
      cleanStateDir,
      hasRetainedMarker: vi.fn(async () => false),
      markRetained: vi.fn(async () => {}),
      removeRecord,
      tombstoneRecord: vi.fn(),
      isTerminalAgent: vi.fn(() => true),
    });

    expect(result).toEqual({ removed: ['agent-pan-2503', 'planning-pan-2503'], preserved: ['agent-pan-2503-review'] });
    expect(removeRecord.mock.calls.map(call => call[0])).toEqual(result.removed);
  });

  it('excludes retained-transcript tombstones before terminal issue resolution', async () => {
    const isTerminalAgent = vi.fn(() => true);
    const cleanStateDir = vi.fn();
    const result = await pruneTerminalStoppedAgents([
      { ...agent('agent-pan-2503', 'stopped', 'work'), phase: RETAINED_TRANSCRIPTS_PHASE },
    ], {
      agentsDir: '/agents',
      cleanStateDir,
      hasRetainedMarker: vi.fn(async () => true),
      markRetained: vi.fn(async () => {}),
      removeRecord: vi.fn(),
      tombstoneRecord: vi.fn(),
      isTerminalAgent,
    });

    expect(result).toEqual({ removed: [], preserved: [] });
    expect(isTerminalAgent).not.toHaveBeenCalled();
    expect(cleanStateDir).not.toHaveBeenCalled();
  });
});
