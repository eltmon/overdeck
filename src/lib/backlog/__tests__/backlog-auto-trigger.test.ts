import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock issue-service-singleton before importing sequencer-agent (which lazy-requires it)
const mockGetIssues = vi.fn().mockReturnValue([
  { id: '1', ref: 'PAN-1', title: 'Real issue', description: '', state: 'open', labels: [], tracker: 'github', url: '' },
]);
vi.mock('../../dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ getIssues: mockGetIssues }),
}));

vi.mock('../sequencer-agent.js', async () => {
  const actual = await vi.importActual<typeof import('../sequencer-agent.js')>('../sequencer-agent.js');
  return {
    ...actual,
    spawnSequencerAgent: vi.fn().mockResolvedValue({ id: 'sequencer-runner', role: 'sequencer' }),
  };
});

import { triggerDebouncedIncrementalPass, stopPeriodicReviewPass } from '../backlog-auto-trigger.js';
import { spawnSequencerAgent } from '../sequencer-agent.js';

describe('backlog-auto-trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    stopPeriodicReviewPass();
    vi.useRealTimers();
  });

  it('calls spawnSequencerAgent after debounce', async () => {
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.runAllTimersAsync();
    expect(spawnSequencerAgent).toHaveBeenCalledWith('incremental', { projectRoot: '/tmp/proj' });
  });

  it('collapses multiple triggers within the debounce window', async () => {
    triggerDebouncedIncrementalPass('/tmp/proj');
    triggerDebouncedIncrementalPass('/tmp/proj');
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.runAllTimersAsync();
    expect(spawnSequencerAgent).toHaveBeenCalledTimes(1);
  });
});
