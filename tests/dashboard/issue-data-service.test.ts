import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IssueDataService, getCanonicalStatus } from '../../src/dashboard/server/services/issue-data-service.js';
import { CacheService } from '../../src/dashboard/server/services/cache-service.js';
import { getLinearApiKey } from '../../src/dashboard/server/services/tracker-config.js';

vi.mock('../../src/dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: vi.fn(() => null),
  getLinearApiKey: vi.fn(() => null),
  getRallyConfig: vi.fn(() => null),
  validateRallyConfig: vi.fn(() => ({ warnings: [] })),
}));

describe('getCanonicalStatus', () => {
  it('should map undefined to backlog', () => {
    expect(getCanonicalStatus(undefined)).toBe('backlog');
  });

  it('should map Backlog/Triage/Unknown to backlog', () => {
    expect(getCanonicalStatus('Backlog')).toBe('backlog');
    expect(getCanonicalStatus('Triage')).toBe('backlog');
    expect(getCanonicalStatus('Unknown')).toBe('backlog');
    expect(getCanonicalStatus('BACKLOG')).toBe('backlog');
  });

  it('should map todo states', () => {
    expect(getCanonicalStatus('Todo')).toBe('todo');
    expect(getCanonicalStatus('To Do')).toBe('todo');
    expect(getCanonicalStatus('Ready')).toBe('todo');
    expect(getCanonicalStatus('Unstarted')).toBe('todo');
  });

  it('should map in-progress states', () => {
    expect(getCanonicalStatus('In Progress')).toBe('in_progress');
    expect(getCanonicalStatus('Started')).toBe('in_progress');
    expect(getCanonicalStatus('Active')).toBe('in_progress');
  });

  it('should map review states', () => {
    expect(getCanonicalStatus('In Review')).toBe('in_review');
    expect(getCanonicalStatus('Review')).toBe('in_review');
    expect(getCanonicalStatus('QA')).toBe('in_review');
  });

  it('should map verifying states', () => {
    expect(getCanonicalStatus('Verifying')).toBe('verifying_on_main');
    expect(getCanonicalStatus('Verifying On Main')).toBe('verifying_on_main');
    expect(getCanonicalStatus('verifying_on_main')).toBe('verifying_on_main');
  });

  it('should map done states', () => {
    expect(getCanonicalStatus('Done')).toBe('done');
    expect(getCanonicalStatus('Completed')).toBe('done');
    expect(getCanonicalStatus('Closed')).toBe('done');
  });

  it('should map canceled states', () => {
    expect(getCanonicalStatus('Canceled')).toBe('canceled');
    expect(getCanonicalStatus('Cancelled')).toBe('canceled');
    expect(getCanonicalStatus('Duplicate')).toBe('canceled');
    expect(getCanonicalStatus("Won't Do")).toBe('canceled');
  });

  it('should default unknown states to backlog', () => {
    expect(getCanonicalStatus('FooBarBaz')).toBe('backlog');
  });
});

describe('IssueDataService - getIssues cycle filter', () => {
  let service: IssueDataService;
  let mockIo: any;
  let mockCache: any;

  beforeEach(() => {
    mockIo = {
      on: vi.fn(),
      emit: vi.fn(),
    };
    mockCache = {
      get: vi.fn(),
      set: vi.fn(),
      getStale: vi.fn(),
      getEtag: vi.fn(),
      updateRateLimit: vi.fn(),
      getRateLimit: vi.fn(),
      getBackoffMs: vi.fn(() => 0),
      isStale: vi.fn(() => true),
      invalidate: vi.fn(),
    };
    service = new IssueDataService(mockCache);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to inject issues directly for testing
  const injectIssues = (issues: any[]) => {
    // @ts-ignore - accessing private property for testing
    service.trackers.linear.lastFetchedIssues = issues;
  };

  describe('cycle filter with canonical status mapping', () => {
    it('should filter out Backlog items from current view', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'Backlog', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'In Progress', updatedAt: new Date().toISOString() },
        { id: '3', identifier: 'TEST-3', status: 'Todo', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues({ cycle: 'current' });

      expect(result).toHaveLength(2);
      expect(result.map(i => i.identifier)).toContain('TEST-2');
      expect(result.map(i => i.identifier)).toContain('TEST-3');
      expect(result.map(i => i.identifier)).not.toContain('TEST-1');
    });

    it('should filter out Triage items from current view (maps to backlog)', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'Triage', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'In Progress', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues({ cycle: 'current' });

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('TEST-2');
    });

    it('should filter out Unknown items from current view (maps to backlog)', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'Unknown', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'In Progress', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues({ cycle: 'current' });

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('TEST-2');
    });

    it('should show only Backlog items in backlog view', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'Backlog', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'In Progress', updatedAt: new Date().toISOString() },
        { id: '3', identifier: 'TEST-3', status: 'Triage', updatedAt: new Date().toISOString() },
        { id: '4', identifier: 'TEST-4', status: 'Unknown', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues({ cycle: 'backlog' });

      expect(result).toHaveLength(3);
      expect(result.map(i => i.identifier)).toContain('TEST-1');
      expect(result.map(i => i.identifier)).toContain('TEST-3');
      expect(result.map(i => i.identifier)).toContain('TEST-4');
      expect(result.map(i => i.identifier)).not.toContain('TEST-2');
    });

    it('should show all items in all view', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'Backlog', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'In Progress', updatedAt: new Date().toISOString() },
        { id: '3', identifier: 'TEST-3', status: 'Triage', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues({ cycle: 'all' });

      expect(result).toHaveLength(3);
    });

    it('should handle case-insensitive status matching', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'BACKLOG', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'backlog', updatedAt: new Date().toISOString() },
        { id: '3', identifier: 'TEST-3', status: 'Backlog', updatedAt: new Date().toISOString() },
        { id: '4', identifier: 'TEST-4', status: 'In Progress', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues({ cycle: 'current' });

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('TEST-4');
    });

    it('should handle various todo states as non-backlog', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'Todo', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'To Do', updatedAt: new Date().toISOString() },
        { id: '3', identifier: 'TEST-3', status: 'Ready', updatedAt: new Date().toISOString() },
        { id: '4', identifier: 'TEST-4', status: 'Backlog', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues({ cycle: 'current' });

      expect(result).toHaveLength(3);
      expect(result.map(i => i.identifier)).toContain('TEST-1');
      expect(result.map(i => i.identifier)).toContain('TEST-2');
      expect(result.map(i => i.identifier)).toContain('TEST-3');
    });

    it('should default to current cycle if no cycle specified', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'Backlog', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'In Progress', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues();

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('TEST-2');
    });

    it('should restore verifying state for reopened issues with merged review status', () => {
      const issues = [
        { id: '1', identifier: 'PAN-1190', status: 'In Progress', state: 'in_progress', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);
      // @ts-ignore - injecting review-status cache for a hot-path unit test
      service.reviewStatusesCache = {
        'PAN-1190': { mergeStatus: 'merged' },
      };

      const result = service.getIssues({ cycle: 'all' });

      expect(result[0]).toMatchObject({
        identifier: 'PAN-1190',
        status: 'Verifying',
        state: 'verifying_on_main',
        canonicalStatus: 'verifying_on_main',
        mergeStatus: 'merged',
      });
    });
  });
});

describe('IssueDataService - fetchLinearIssues rate-limit headers', () => {
  let service: IssueDataService;
  let mockCache: any;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    mockCache = {
      get: vi.fn(),
      set: vi.fn(),
      getStale: vi.fn(),
      getEtag: vi.fn(),
      updateRateLimit: vi.fn(),
      getRateLimit: vi.fn(),
      getBackoffMs: vi.fn(() => 0),
      isStale: vi.fn(() => true),
      invalidate: vi.fn(),
    };
    service = new IssueDataService(mockCache);

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.mocked(getLinearApiKey).mockReturnValue('linear-api-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function makeLinearResponse(headers: Record<string, string>, body: any, status: number = 200) {
    const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(bodyText),
    };
  }

  it('records Linear rate-limit headers before reading the body', async () => {
    const resetMs = Date.now() + 3_600_000;
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {
          'x-ratelimit-requests-remaining': '2499',
          'x-ratelimit-requests-limit': '2500',
          'x-ratelimit-requests-reset': String(resetMs),
        },
        { data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
      )
    );

    await (service as any).fetchLinearIssues('linear-api-key', null);

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', {
      remaining: 2499,
      total: 2500,
      resetAt: new Date(resetMs).toISOString(),
    });
  });

  it('normalizes reset values below 1e12 as Unix seconds', async () => {
    const resetSeconds = 1_700_000_000;
    const expectedResetAt = new Date(resetSeconds * 1000).toISOString();
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {
          'x-ratelimit-requests-remaining': '100',
          'x-ratelimit-requests-limit': '2500',
          'x-ratelimit-requests-reset': String(resetSeconds),
        },
        { data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
      )
    );

    await (service as any).fetchLinearIssues('linear-api-key', null);

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', expect.objectContaining({
      resetAt: expectedResetAt,
    }));
  });

  it('normalizes reset values at or above 1e12 as Unix milliseconds', async () => {
    const resetMs = 1_700_000_000_000;
    const expectedResetAt = new Date(resetMs).toISOString();
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {
          'x-ratelimit-requests-remaining': '100',
          'x-ratelimit-requests-limit': '2500',
          'x-ratelimit-requests-reset': String(resetMs),
        },
        { data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
      )
    );

    await (service as any).fetchLinearIssues('linear-api-key', null);

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', expect.objectContaining({
      resetAt: expectedResetAt,
    }));
  });

  it('falls back to bare x-ratelimit-* header names', async () => {
    const resetMs = Date.now() + 3_600_000;
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {
          'x-ratelimit-remaining': '1500',
          'x-ratelimit-limit': '2500',
          'x-ratelimit-reset': String(resetMs),
        },
        { data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
      )
    );

    await (service as any).fetchLinearIssues('linear-api-key', null);

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', {
      remaining: 1500,
      total: 2500,
      resetAt: new Date(resetMs).toISOString(),
    });
  });

  it('skips update and does not throw when headers are missing', async () => {
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {},
        { data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
      )
    );

    await (service as any).fetchLinearIssues('linear-api-key', null);

    expect(mockCache.updateRateLimit).not.toHaveBeenCalled();
  });

  it('skips update and does not throw when header values are unparseable', async () => {
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {
          'x-ratelimit-requests-remaining': 'nope',
          'x-ratelimit-requests-limit': '2500',
          'x-ratelimit-requests-reset': String(Date.now() + 3_600_000),
        },
        { data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
      )
    );

    await (service as any).fetchLinearIssues('linear-api-key', null);

    expect(mockCache.updateRateLimit).not.toHaveBeenCalled();
  });

  it('records rate-limit headers even when the GraphQL body contains errors', async () => {
    const resetMs = Date.now() + 3_600_000;
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {
          'x-ratelimit-requests-remaining': '0',
          'x-ratelimit-requests-limit': '2500',
          'x-ratelimit-requests-reset': String(resetMs),
        },
        { errors: [{ message: 'RATELIMITED' }] }
      )
    );

    await expect((service as any).fetchLinearIssues('linear-api-key', null)).rejects.toThrow('RATELIMITED');

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', expect.objectContaining({
      remaining: 0,
      total: 2500,
      resetAt: new Date(resetMs).toISOString(),
    }));
  });

  it('records exhaustion on HTTP 429 before throwing', async () => {
    const resetMs = Date.now() + 3_600_000;
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {
          'x-ratelimit-requests-remaining': '0',
          'x-ratelimit-requests-limit': '2500',
          'x-ratelimit-requests-reset': String(resetMs),
        },
        { errors: [{ message: 'Rate limit exceeded' }] },
        429
      )
    );

    await expect((service as any).fetchLinearIssues('linear-api-key', null)).rejects.toThrow('Rate limit exceeded');

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', expect.objectContaining({
      remaining: 0,
      total: 2500,
      resetAt: new Date(resetMs).toISOString(),
    }));
  });

  it('derives resetAt from Retry-After on 429 when rate-limit headers are absent', async () => {
    const retryAfterSeconds = 120;
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        { 'retry-after': String(retryAfterSeconds) },
        'Too Many Requests',
        429
      )
    );

    await expect((service as any).fetchLinearIssues('linear-api-key', null)).rejects.toThrow('HTTP 429');

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', expect.objectContaining({
      remaining: 0,
      resetAt: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
    }));
  });

  it('defaults resetAt to one hour on 429 when no reset or Retry-After is present', async () => {
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {},
        'Too Many Requests',
        429
      )
    );

    await expect((service as any).fetchLinearIssues('linear-api-key', null)).rejects.toThrow('HTTP 429');

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', expect.objectContaining({
      remaining: 0,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));
  });

  it('records exhaustion on GraphQL RATELIMITED error (HTTP 200) before throwing', async () => {
    fetchMock.mockResolvedValueOnce(
      makeLinearResponse(
        {},
        { errors: [{ message: 'RATELIMITED' }] }
      )
    );

    await expect((service as any).fetchLinearIssues('linear-api-key', null)).rejects.toThrow('RATELIMITED');

    expect(mockCache.updateRateLimit).toHaveBeenCalledWith('linear', expect.objectContaining({
      remaining: 0,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));
  });
});

describe('IssueDataService - scheduleNext suspension', () => {
  let service: IssueDataService;
  let mockCache: any;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    vi.mocked(getLinearApiKey).mockReturnValue(null);

    mockCache = {
      get: vi.fn(),
      set: vi.fn(),
      getStale: vi.fn(),
      getEtag: vi.fn(),
      updateRateLimit: vi.fn(),
      getRateLimit: vi.fn(),
      getBackoffMs: vi.fn(() => 0),
      getSuspensionMs: vi.fn(() => 0),
      isStale: vi.fn(() => true),
      invalidate: vi.fn(),
    };
    service = new IssueDataService(mockCache);
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('arms the timer for the suspension delay when getSuspensionMs > 0', () => {
    mockCache.getSuspensionMs.mockReturnValue(120_000);
    (service as any).started = true;
    (service as any).scheduleNext('linear');

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 120_000);
    expect((service as any).trackers.linear.currentInterval).toBe(120_000);
  });

  it('clamps suspension delay to 3_600_000 ms', () => {
    mockCache.getSuspensionMs.mockReturnValue(10_000_000);
    (service as any).started = true;
    (service as any).scheduleNext('linear');

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3_600_000);
    expect((service as any).trackers.linear.currentInterval).toBe(3_600_000);
  });

  it('uses the normal effectiveInterval when getSuspensionMs returns 0', () => {
    (service as any).started = true;
    (service as any).scheduleNext('linear');

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect((service as any).trackers.linear.currentInterval).toBe(30_000);
  });

  it('resumes the normal interval after the suspension delay elapses and clears', async () => {
    mockCache.getSuspensionMs.mockReturnValueOnce(120_000).mockReturnValueOnce(0);
    (service as any).started = true;
    (service as any).scheduleNext('linear');

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 120_000);

    setTimeoutSpy.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 30_000);
  });
});
