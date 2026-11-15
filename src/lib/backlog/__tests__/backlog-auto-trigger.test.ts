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

import { MIN_AUTO_PASS_INTERVAL_MS, resetBacklogAutoTriggerForTests, triggerDebouncedIncrementalPass } from '../backlog-auto-trigger.js';
import { spawnSequencerAgent } from '../sequencer-agent.js';

describe('backlog-auto-trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetBacklogAutoTriggerForTests();
    delete process.env.OVERDECK_NO_RESUME;
    delete process.env.OVERDECK_DISABLE_DEACON;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.OVERDECK_NO_RESUME;
    delete process.env.OVERDECK_DISABLE_DEACON;
  });

  it('calls spawnSequencerAgent after debounce', async () => {
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.runAllTimersAsync();
    expect(spawnSequencerAgent).toHaveBeenCalledWith('incremental', { projectRoot: '/tmp/proj', skipWhenUnchanged: true });
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
  it('suppresses the incremental pass when OVERDECK_NO_RESUME is set, and starts no window', async () => {
    process.env.OVERDECK_NO_RESUME = '1';
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.runAllTimersAsync();
    expect(spawnSequencerAgent).not.toHaveBeenCalled();

    delete process.env.OVERDECK_NO_RESUME;
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spawnSequencerAgent).toHaveBeenCalledTimes(1);
  });


  // fix10: a peer dashboard is a read/UI peer, never an orchestrator. One ran
  // this trigger and spawned a real Opus sequencer-runner into the live session.
  it('suppresses the incremental pass in a peer dashboard, and starts no window', async () => {
    process.env.OVERDECK_DISABLE_DEACON = '1';
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.runAllTimersAsync();
    expect(spawnSequencerAgent).not.toHaveBeenCalled();

    delete process.env.OVERDECK_DISABLE_DEACON;
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spawnSequencerAgent).toHaveBeenCalledTimes(1);
  });


  // The gate is checked at FIRE time: a timer scheduled before the operator
  // exports the env is still suppressed when it fires.
  it('suppresses an already-scheduled pass when the env appears before it fires, and starts no window', async () => {
    triggerDebouncedIncrementalPass('/tmp/proj');
    process.env.OVERDECK_NO_RESUME = '1';
    await vi.runAllTimersAsync();
    expect(spawnSequencerAgent).not.toHaveBeenCalled();

    delete process.env.OVERDECK_NO_RESUME;
    triggerDebouncedIncrementalPass('/tmp/proj');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(spawnSequencerAgent).toHaveBeenCalledTimes(1);
  });

  describe('the 30-minute automatic-pass window (PAN-5357)', () => {
    it('deltas inside the window coalesce into one pass at the window end', async () => {
      triggerDebouncedIncrementalPass('/tmp/proj');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(spawnSequencerAgent).toHaveBeenCalledTimes(1);

      triggerDebouncedIncrementalPass('/tmp/proj');
      await vi.advanceTimersByTimeAsync(60_000);
      triggerDebouncedIncrementalPass('/tmp/proj');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(spawnSequencerAgent).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(MIN_AUTO_PASS_INTERVAL_MS);
      expect(spawnSequencerAgent).toHaveBeenCalledTimes(2);
    });

    it('a skipped pass does not start the window', async () => {
      vi.mocked(spawnSequencerAgent).mockResolvedValueOnce(null);

      triggerDebouncedIncrementalPass('/tmp/proj');
      await vi.advanceTimersByTimeAsync(30_000);
      triggerDebouncedIncrementalPass('/tmp/proj');
      await vi.advanceTimersByTimeAsync(30_000);

      expect(spawnSequencerAgent).toHaveBeenCalledTimes(2);
    });

    it('a failed pass does not start the window', async () => {
      vi.mocked(spawnSequencerAgent).mockRejectedValueOnce(new Error('boom'));

      triggerDebouncedIncrementalPass('/tmp/proj');
      await vi.advanceTimersByTimeAsync(30_000);
      triggerDebouncedIncrementalPass('/tmp/proj');
      await vi.advanceTimersByTimeAsync(30_000);

      expect(spawnSequencerAgent).toHaveBeenCalledTimes(2);
    });
  });
});
