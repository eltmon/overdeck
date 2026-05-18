import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IssueDataService, getCanonicalStatus } from '../../src/dashboard/server/services/issue-data-service.js';
import { CacheService } from '../../src/dashboard/server/services/cache-service.js';

// Mock dependencies
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
