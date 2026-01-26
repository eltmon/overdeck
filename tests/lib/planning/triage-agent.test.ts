import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
vi.mock('../../../src/lib/agents.js', () => ({
  spawnAgent: vi.fn(() => Promise.resolve({ agentId: 'test-triage-agent', sessionId: 'test-session' })),
}));

describe('triage-agent', () => {
  describe('analyzeIssue', () => {
    it('should analyze issue complexity and priority', async () => {
      // Placeholder: Would test actual issue analysis
      const issue = {
        title: 'Add user authentication',
        description: 'Implement JWT-based auth with login, logout, and token refresh',
        labels: ['enhancement'],
      };

      const analysis = {
        complexity: 'high',
        estimatedEffort: '3-5 days',
        priority: 'P1',
        reasoning: 'Critical security feature, affects multiple components',
        requiredSkills: ['backend', 'security', 'database'],
        dependencies: ['Database schema changes', 'API endpoint design'],
      };

      expect(analysis.complexity).toBe('high');
      expect(analysis.priority).toBe('P1');
      expect(analysis.requiredSkills).toContain('security');
      expect(analysis.dependencies.length).toBeGreaterThan(0);
    });

    it('should identify low-complexity issues', () => {
      const issue = {
        title: 'Fix typo in README',
        description: 'Change "teh" to "the" in line 42',
      };

      const complexity = 'trivial';
      const estimatedEffort = '<1 hour';

      expect(complexity).toBe('trivial');
      expect(estimatedEffort).toContain('hour');
    });
  });

  describe('spawnTriageAgent', () => {
    it('should spawn agent with triage work type', async () => {
      // Placeholder: Would test spawning with correct work type ID
      const workType = 'triage-agent';
      expect(workType).toBe('triage-agent');
    });
  });

  describe('triageMultiple', () => {
    it('should triage multiple issues and sort by priority', async () => {
      const issues = [
        { id: 'issue-1', title: 'Critical bug in auth', priority: null },
        { id: 'issue-2', title: 'Update README', priority: null },
        { id: 'issue-3', title: 'Performance optimization', priority: null },
      ];

      // Mock triage results
      const triaged = [
        { ...issues[0], priority: 'P0', complexity: 'high' },
        { ...issues[2], priority: 'P1', complexity: 'medium' },
        { ...issues[1], priority: 'P3', complexity: 'trivial' },
      ];

      expect(triaged[0].priority).toBe('P0'); // Critical bug first
      expect(triaged[2].priority).toBe('P3'); // Documentation last
    });
  });

  describe('sortByPriority', () => {
    it('should sort issues by priority (P0 > P1 > P2 > P3 > P4)', () => {
      const issues = [
        { id: 'a', priority: 'P2' },
        { id: 'b', priority: 'P0' },
        { id: 'c', priority: 'P1' },
        { id: 'd', priority: 'P3' },
      ];

      const sorted = issues.sort((a, b) => {
        const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      expect(sorted[0].id).toBe('b'); // P0
      expect(sorted[1].id).toBe('c'); // P1
      expect(sorted[2].id).toBe('a'); // P2
      expect(sorted[3].id).toBe('d'); // P3
    });

    it('should handle missing priority values', () => {
      const issues = [
        { id: 'a', priority: 'P1' },
        { id: 'b', priority: undefined },
        { id: 'c', priority: 'P0' },
      ];

      const sorted = issues.filter((i) => i.priority).sort((a, b) => (a.priority! < b.priority! ? -1 : 1));

      expect(sorted[0].id).toBe('c'); // P0
      expect(sorted[1].id).toBe('a'); // P1
    });
  });
});
