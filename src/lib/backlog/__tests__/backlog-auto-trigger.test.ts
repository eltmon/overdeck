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

import { triggerDebouncedIncrementalPass, startPeriodicReviewPass, stopPeriodicReviewPass } from '../backlog-auto-trigger.js';
import { spawnSequencerAgent } from '../sequencer-agent.js';

describe('backlog-auto-trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.OVERDECK_NO_RESUME;
  });
  afterEach(() => {
    stopPeriodicReviewPass();
    vi.useRealTimers();
    delete process.env.OVERDECK_NO_RESUME;
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

  // PAN-2396: --no-resume is the full-quiescence escape hatch — no autonomous
  // sequencer pass may spawn while the boot carries OVERDECK_NO_RESUME.
  it('suppresses the incremental pass when OVERDECK_NO_RESUME is set', async () => {
    process.env.OVERDECK_NO_RESUME = '1';
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.runAllTimersAsync();
    expect(spawnSequencerAgent).not.toHaveBeenCalled();
  });

  it('suppresses the periodic review pass when OVERDECK_NO_RESUME is set', async () => {
    process.env.OVERDECK_NO_RESUME = '1';
    startPeriodicReviewPass('/tmp/proj', 60_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(spawnSequencerAgent).not.toHaveBeenCalled();
  });

  // The gate is checked at FIRE time: a timer scheduled before the operator
  // exports the env is still suppressed when it fires.
  it('suppresses an already-scheduled pass when the env appears before it fires', async () => {
    triggerDebouncedIncrementalPass('/tmp/proj');
    process.env.OVERDECK_NO_RESUME = '1';
    await vi.runAllTimersAsync();
    expect(spawnSequencerAgent).not.toHaveBeenCalled();
  });
});
