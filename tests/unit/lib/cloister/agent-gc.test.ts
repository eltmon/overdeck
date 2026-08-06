import { describe, expect, it, vi } from 'vitest';
import {
  confirmLiveAgentTerminality,
  pruneStoppedAgentsForIssue,
  resolveLiveAgentTerminalityEvidence,
  pruneTerminalStoppedAgents,
  type AgentGcDeps,
  type AgentGcTerminalityDeps,
} from '../../../../src/lib/cloister/agent-gc.js';
import { RETAINED_TRANSCRIPTS_PHASE } from '../../../../src/lib/overdeck/agents.js';
import type { AgentState } from '../../../../src/lib/agents/agent-state.js';

const agent = (id: string, status: AgentState['status'], role: AgentState['role']): AgentState => ({
  id, issueId: 'PAN-2503', workspace: '/workspace', harness: 'codex', role, model: 'gpt-5.6', status, startedAt: '2026-07-10T00:00:00Z',
});

function terminalityDeps(
  overrides: Partial<AgentGcTerminalityDeps> = {},
): AgentGcTerminalityDeps {
  return {
    hasClosedOutFlag: vi.fn(() => true),
    readTrackerState: vi.fn(async () => 'closed'),
    hasLiveTmuxSession: vi.fn(async () => false),
    hasOpenChangeRequest: vi.fn(async () => false),
    hasInFlightReviewOrTest: vi.fn(() => false),
    log: vi.fn(),
    ...overrides,
  };
}

function gcDeps(overrides: Partial<AgentGcDeps> = {}): AgentGcDeps {
  return {
    agentsDir: '/agents',
    cleanStateDir: vi.fn(async () => ({
      removedFiles: 0,
      preservedTranscripts: 0,
      removedDir: true,
    })),
    listFilesToRemove: vi.fn(async () => []),
    hasRetainedMarker: vi.fn(async () => false),
    markRetained: vi.fn(async () => {}),
    writeTombstone: vi.fn(async () => {}),
    emitPruneEvent: vi.fn(),
    removeRecord: vi.fn(),
    tombstoneRecord: vi.fn(),
    isTerminalAgent: vi.fn(() => true),
    log: vi.fn(),
    ...overrides,
  };
}

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
    ], gcDeps({
      cleanStateDir,
      removeRecord,
    }));

    expect(result).toEqual({ removed: ['agent-pan-2503', 'planning-pan-2503'], preserved: ['agent-pan-2503-review'] });
    expect(removeRecord.mock.calls.map(call => call[0])).toEqual(result.removed);
  });

  it('excludes retained-transcript tombstones before terminal issue resolution', async () => {
    const isTerminalAgent = vi.fn(() => true);
    const cleanStateDir = vi.fn();
    const result = await pruneTerminalStoppedAgents([
      { ...agent('agent-pan-2503', 'stopped', 'work'), phase: RETAINED_TRANSCRIPTS_PHASE },
    ], gcDeps({
      cleanStateDir,
      hasRetainedMarker: vi.fn(async () => true),
      isTerminalAgent,
    }));

    expect(result).toEqual({ removed: [], preserved: [] });
    expect(isTerminalAgent).not.toHaveBeenCalled();
    expect(cleanStateDir).not.toHaveBeenCalled();
  });
});

describe('PAN-3513 live terminality confirmation', () => {
  it('preserves a stopped agent when the tracker is open', async () => {
    const deps = terminalityDeps({ readTrackerState: vi.fn(async () => 'open') });

    await expect(confirmLiveAgentTerminality(
      agent('agent-pan-2503', 'stopped', 'work'),
      deps,
    )).resolves.toBe(false);

    expect(deps.hasLiveTmuxSession).not.toHaveBeenCalled();
  });

  it('preserves a stopped agent when its tmux session is live', async () => {
    const deps = terminalityDeps({ hasLiveTmuxSession: vi.fn(async () => true) });

    await expect(confirmLiveAgentTerminality(
      agent('agent-pan-2503', 'stopped', 'work'),
      deps,
    )).resolves.toBe(false);

    expect(deps.hasOpenChangeRequest).not.toHaveBeenCalled();
  });

  it('preserves a stopped agent when an open PR or MR exists', async () => {
    const deps = terminalityDeps({ hasOpenChangeRequest: vi.fn(async () => true) });

    await expect(confirmLiveAgentTerminality(
      agent('agent-pan-2503', 'stopped', 'work'),
      deps,
    )).resolves.toBe(false);

    expect(deps.hasInFlightReviewOrTest).not.toHaveBeenCalled();
  });

  it('preserves a stopped agent when review or test work is in flight', async () => {
    const deps = terminalityDeps({ hasInFlightReviewOrTest: vi.fn(() => true) });

    await expect(confirmLiveAgentTerminality(
      agent('agent-pan-2503', 'stopped', 'work'),
      deps,
    )).resolves.toBe(false);
  });

  it('preserves a stopped agent when any live check throws', async () => {
    const cleanStateDir = vi.fn();
    const log = vi.fn();
    const candidate = agent('agent-pan-2503', 'stopped', 'work');
    const result = await pruneTerminalStoppedAgents([candidate], gcDeps({
      cleanStateDir,
      isTerminalAgent: vi.fn(async () => {
        throw new Error('tracker unavailable');
      }),
      log,
    }));

    expect(result).toEqual({ removed: [], preserved: ['agent-pan-2503'] });
    expect(cleanStateDir).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('tracker unavailable'));
  });

  it('resolves live terminality without tombstoning or cleaning during a dry run', async () => {
    const candidate = agent('agent-pan-2503', 'stopped', 'work');
    const deps = gcDeps({ isTerminalAgent: vi.fn(() => true) });

    const result = await pruneTerminalStoppedAgents(
      [candidate],
      deps,
      { dryRun: true },
    );

    expect(result).toEqual({ removed: ['agent-pan-2503'], preserved: [] });
    expect(deps.writeTombstone).not.toHaveBeenCalled();
    expect(deps.cleanStateDir).not.toHaveBeenCalled();
    expect(deps.removeRecord).not.toHaveBeenCalled();
  });

  it('writes and emits the live predicate tombstone before cleanup', async () => {
    const candidate = agent('agent-pan-2503', 'stopped', 'work');
    const deps = terminalityDeps();
    const order: string[] = [];
    const writeTombstone = vi.fn(async () => { order.push('tombstone'); });
    const emitPruneEvent = vi.fn(() => { order.push('event'); });
    const cleanStateDir = vi.fn(async () => {
      order.push('cleanup');
      return {
        removedFiles: 3,
        preservedTranscripts: 0,
        removedDir: true,
      };
    });
    const removeRecord = vi.fn();
    const result = await pruneTerminalStoppedAgents([candidate], gcDeps({
      cleanStateDir,
      listFilesToRemove: vi.fn(async () => ['session.id', 'runtime.json']),
      writeTombstone,
      emitPruneEvent,
      removeRecord,
      isTerminalAgent: (row) => resolveLiveAgentTerminalityEvidence(row, deps),
    }));

    expect(result).toEqual({ removed: ['agent-pan-2503'], preserved: [] });
    expect(order).toEqual(['tombstone', 'event', 'cleanup']);
    expect(writeTombstone).toHaveBeenCalledWith(candidate, expect.objectContaining({
      event: 'tombstoned',
      predicate: {
        closedOutFlag: true,
        trackerState: 'closed',
        liveTmux: false,
        openChangeRequest: false,
        inFlightReviewOrTest: false,
      },
      filesRemoved: ['session.id', 'runtime.json'],
    }));
    expect(cleanStateDir).toHaveBeenCalledWith('/agents/agent-pan-2503', '/agents');
    expect(removeRecord).toHaveBeenCalledWith('agent-pan-2503');
  });

  it('preserves local state when the durable tombstone fails', async () => {
    const candidate = agent('agent-pan-2503', 'stopped', 'work');
    const cleanStateDir = vi.fn();
    const emitPruneEvent = vi.fn();
    const result = await pruneTerminalStoppedAgents([candidate], gcDeps({
      cleanStateDir,
      writeTombstone: vi.fn(async () => { throw new Error('state push failed'); }),
      emitPruneEvent,
      isTerminalAgent: vi.fn(() => true),
    }));

    expect(result).toEqual({ removed: [], preserved: ['agent-pan-2503'] });
    expect(emitPruneEvent).not.toHaveBeenCalled();
    expect(cleanStateDir).not.toHaveBeenCalled();
  });
});
