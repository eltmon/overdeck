import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IssueDataService } from '../../src/dashboard/server/services/issue-data-service.js';
import { CacheService } from '../../src/dashboard/server/services/cache-service.js';

// Mock dependencies
vi.mock('../../src/dashboard/server/services/tracker-config.js', () => ({
  getGitHubConfig: vi.fn(() => null),
  getLinearApiKey: vi.fn(() => null),
  getRallyConfig: vi.fn(() => null),
  validateRallyConfig: vi.fn(() => ({ warnings: [] })),
}));

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
    service = new IssueDataService(mockIo, mockCache);
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

    it('should handle planning states as non-backlog', () => {
      const issues = [
        { id: '1', identifier: 'TEST-1', status: 'In Planning', updatedAt: new Date().toISOString() },
        { id: '2', identifier: 'TEST-2', status: 'Planning', updatedAt: new Date().toISOString() },
        { id: '3', identifier: 'TEST-3', status: 'Planned', updatedAt: new Date().toISOString() },
        { id: '4', identifier: 'TEST-4', status: 'Backlog', updatedAt: new Date().toISOString() },
      ];
      injectIssues(issues);

      const result = service.getIssues({ cycle: 'current' });

      expect(result).toHaveLength(3);
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
  });
});
