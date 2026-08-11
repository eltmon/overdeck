import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveTrackerTypeSync = vi.fn();
const mockResolveGitHubIssueSync = vi.fn();
const mockGetIssue = vi.fn();
const mockCreateTracker = vi.fn(() => ({ getIssue: mockGetIssue }));

vi.mock('../../../../lib/tracker-utils.js', () => ({
  resolveTrackerTypeSync: (id: string) => mockResolveTrackerTypeSync(id),
  resolveGitHubIssueSync: (id: string) => mockResolveGitHubIssueSync(id),
}));
vi.mock('../../../../lib/tracker/factory.js', () => ({
  createTracker: (config: unknown) => mockCreateTracker(config),
}));

// Import once at module scope; vi.mock hoisting ensures mocks are wired.
const { resolveMissingIssueTitles, resolveMissingIssue } = await import('../issue-title-fallback.js');

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

// PAN-3659: createTracker({ type }) alone throws for GitHub (owner/repo
// required), which silently broke this fallback for every GitHub issue.
describe('GitHub tracker binding (PAN-3659)', () => {
  beforeEach(() => {
    mockResolveTrackerTypeSync.mockReset().mockReturnValue('github');
    mockResolveGitHubIssueSync.mockReset();
    mockGetIssue.mockReset();
    mockCreateTracker.mockClear();
  });

  it('binds owner/repo from the issue prefix for github issues', async () => {
    mockResolveGitHubIssueSync.mockReturnValue({
      isGitHub: true, owner: 'eltmon', repo: 'overdeck', prefix: 'PAN', number: 3659,
    });
    mockGetIssue.mockReturnValue(issueEffect('backfill fix'));

    const result = await resolveMissingIssueTitles(['PAN-3659']);

    expect(mockCreateTracker).toHaveBeenCalledWith({ type: 'github', owner: 'eltmon', repo: 'overdeck' });
    expect(result.get('PAN-3659')).toBe('backfill fix');
  });

  it('resolves nothing when the github prefix maps to no repo', async () => {
    mockResolveGitHubIssueSync.mockReturnValue({ isGitHub: false });

    const result = await resolveMissingIssueTitles(['ZZZ-9']);

    expect(result.size).toBe(0);
    expect(mockCreateTracker).not.toHaveBeenCalled();
  });
});

describe('resolveMissingIssue', () => {
  beforeEach(() => {
    mockResolveTrackerTypeSync.mockReset().mockReturnValue('linear');
    mockGetIssue.mockReset();
    mockCreateTracker.mockClear();
  });

  it('returns the full tracker issue and memoizes it case-insensitively', async () => {
    const full = { title: 'Full row', state: 'closed', url: 'https://linear.app/x/MIN-9999' };
    mockGetIssue.mockReturnValue(Effect.succeed(full));

    const first = await resolveMissingIssue('MIN-9999');
    expect(first).toEqual(full);

    const second = await resolveMissingIssue('min-9999');
    expect(second).toBe(full);
    expect(mockGetIssue).toHaveBeenCalledTimes(1);
  });
});
