import type { MemoryObservation } from '@panctl/contracts';
import { describe, expect, it } from 'vitest';
import { createObservationFeedSelector, MAX_OBSERVATION_FEED_ENTRIES } from '../useObservationFeed';

function observation(overrides: Partial<MemoryObservation>): MemoryObservation {
  return {
    id: 'obs-1',
    timestamp: '2026-05-23T01:00:00.000Z',
    projectId: 'panopticon',
    workspaceId: 'workspace-a',
    issueId: 'PAN-1389',
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
    gitBranch: 'feature/pan-1389',
    sourceTranscriptOffset: 0,
    actionStatus: 'Building selector',
    narrative: 'The agent is building the selector.',
    summary: 'Building selector',
    files: [],
    tags: [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'claude-opus-4-7',
    ...overrides,
  };
}

describe('createObservationFeedSelector', () => {
  it('flattens observations from every issueId key', () => {
    const selector = createObservationFeedSelector();

    const entries = selector({
      observationsByIssueId: {
        'PAN-1': [observation({ id: 'obs-1', issueId: 'PAN-1' })],
        'PAN-2': [observation({ id: 'obs-2', issueId: 'PAN-2' })],
      },
    });

    expect(entries.map((entry) => entry.id)).toEqual(['obs-1', 'obs-2']);
  });

  it('filters out observations with null actionStatus', () => {
    const selector = createObservationFeedSelector();

    const entries = selector({
      observationsByIssueId: {
        'PAN-1': [
          observation({ id: 'with-status', actionStatus: 'Working' }),
          observation({ id: 'without-status', actionStatus: null }),
        ],
      },
    });

    expect(entries.map((entry) => entry.id)).toEqual(['with-status']);
  });

  it('sorts newest-first by timestamp', () => {
    const selector = createObservationFeedSelector();

    const entries = selector({
      observationsByIssueId: {
        'PAN-1': [
          observation({ id: 'old', timestamp: '2026-05-23T01:00:00.000Z' }),
          observation({ id: 'new', timestamp: '2026-05-23T03:00:00.000Z' }),
          observation({ id: 'mid', timestamp: '2026-05-23T02:00:00.000Z' }),
        ],
      },
    });

    expect(entries.map((entry) => entry.id)).toEqual(['new', 'mid', 'old']);
  });

  it('caps output at the most recent 500 entries', () => {
    const selector = createObservationFeedSelector();
    const observations = Array.from({ length: MAX_OBSERVATION_FEED_ENTRIES + 1 }, (_, index) => observation({
      id: `obs-${index}`,
      timestamp: new Date(Date.UTC(2026, 4, 23, 0, 0, index)).toISOString(),
    }));

    const entries = selector({ observationsByIssueId: { 'PAN-1': observations } });

    expect(entries).toHaveLength(MAX_OBSERVATION_FEED_ENTRIES);
    expect(entries[0]?.id).toBe('obs-500');
    expect(entries.at(-1)?.id).toBe('obs-1');
  });

  it('returns the same result reference when the source slice identity is unchanged', () => {
    const selector = createObservationFeedSelector();
    const observationsByIssueId = {
      'PAN-1': [observation({ id: 'obs-1' })],
    };

    const first = selector({ observationsByIssueId });
    const second = selector({ observationsByIssueId });

    expect(second).toBe(first);
  });
});
