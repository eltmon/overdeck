import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveTrackerTypeSync = vi.fn();
const mockGetIssue = vi.fn();
const mockCreateTracker = vi.fn(() => ({ getIssue: mockGetIssue }));

vi.mock('../../../../lib/tracker-utils.js', () => ({
  resolveTrackerTypeSync: (id: string) => mockResolveTrackerTypeSync(id),
}));
vi.mock('../../../../lib/tracker/factory.js', () => ({
  createTracker: (config: unknown) => mockCreateTracker(config),
}));

// Import once at module scope; vi.mock hoisting ensures mocks are wired.
const { resolveMissingIssueTitles } = await import('../issue-title-fallback.js');

const { Effect } = await import('effect');

function issueEffect(title: string) {
  return Effect.succeed({ title });
}

describe('resolveMissingIssueTitles', () => {
  beforeEach(() => {
    mockResolveTrackerTypeSync.mockReset().mockReturnValue('linear');
    mockGetIssue.mockReset();
    mockCreateTracker.mockClear();
  });

  it('resolves a title through the tracker and memoizes it across passes', async () => {
    mockGetIssue.mockReturnValue(issueEffect('Habits: full bug audit'));

    const first = await resolveMissingIssueTitles(['MIN-9852']);
    expect(first.get('MIN-9852')).toBe('Habits: full bug audit');
    expect(mockGetIssue).toHaveBeenCalledTimes(1);

    const second = await resolveMissingIssueTitles(['min-9852']);
    expect(second.get('MIN-9852')).toBe('Habits: full bug audit');
    expect(mockGetIssue).toHaveBeenCalledTimes(1);
  });

  it('memoizes a failed lookup instead of re-fetching every pass', async () => {
    mockGetIssue.mockReturnValue(Effect.fail(new Error('tracker down')));

    const first = await resolveMissingIssueTitles(['MIN-9861']);
    expect(first.has('MIN-9861')).toBe(false);
    expect(mockGetIssue).toHaveBeenCalledTimes(1);

    const second = await resolveMissingIssueTitles(['MIN-9861']);
    expect(second.has('MIN-9861')).toBe(false);
    expect(mockGetIssue).toHaveBeenCalledTimes(1);
  });

  it('skips issues with no resolvable tracker and titles equal to the id', async () => {
    mockResolveTrackerTypeSync.mockReturnValue(null);
    const none = await resolveMissingIssueTitles(['XXX-1']);
    expect(none.size).toBe(0);
    expect(mockCreateTracker).not.toHaveBeenCalled();

    mockResolveTrackerTypeSync.mockReturnValue('linear');
    mockGetIssue.mockReturnValue(issueEffect('  MIN-9877  '));
    const echoed = await resolveMissingIssueTitles(['MIN-9877']);
    expect(echoed.has('MIN-9877')).toBe(false);
  });

  it('caps tracker lookups per pass', async () => {
    mockGetIssue.mockReturnValue(issueEffect('some title'));
    const ids = Array.from({ length: 20 }, (_, i) => `MIN-77${i.toString().padStart(2, '0')}`);
    const resolved = await resolveMissingIssueTitles(ids);
    expect(resolved.size).toBe(8);
    expect(mockGetIssue).toHaveBeenCalledTimes(8);
  });
});
