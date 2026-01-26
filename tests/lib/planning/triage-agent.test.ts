import { describe, it, expect } from 'vitest';
import { analyzeIssue, triageMultiple, sortByPriority } from '../../../src/lib/planning/triage-agent.js';
import type { TriageOptions, TriageResult } from '../../../src/lib/planning/triage-agent.js';

describe('triage-agent', () => {
  describe('analyzeIssue', () => {
    it('should classify P0 for production outages', () => {
      const options: TriageOptions = {
        issueId: 'TEST-1',
        title: 'Production is down',
        description: 'Users cannot access the site',
      };

      const result = analyzeIssue(options);

      expect(result.priority).toBe('P0');
      expect(result.issueId).toBe('TEST-1');
    });

    it('should classify P0 for security vulnerabilities', () => {
      const options: TriageOptions = {
        issueId: 'TEST-2',
        title: 'Security vulnerability in auth system',
      };

      const result = analyzeIssue(options);

      expect(result.priority).toBe('P0');
    });

    it('should classify P1 for critical bugs', () => {
      const options: TriageOptions = {
        issueId: 'TEST-3',
        title: 'Critical: Users cannot login',
        description: 'Login form is broken',
      };

      const result = analyzeIssue(options);

      expect(result.priority).toBe('P1');
    });

    it('should classify P2 for important features', () => {
      const options: TriageOptions = {
        issueId: 'TEST-4',
        title: 'Important: Add user analytics',
        labels: ['high'],
      };

      const result = analyzeIssue(options);

      expect(result.priority).toBe('P2');
    });

    it('should classify P4 for nice-to-have enhancements', () => {
      const options: TriageOptions = {
        issueId: 'TEST-5',
        title: 'Nice to have: Polish the UI animations',
      };

      const result = analyzeIssue(options);

      expect(result.priority).toBe('P4');
    });

    it('should use Linear priority when provided', () => {
      const options: TriageOptions = {
        issueId: 'TEST-6',
        title: 'Some task',
        currentPriority: 2,
      };

      const result = analyzeIssue(options);

      expect(result.priority).toBe('P2');
    });

    it('should classify trivial complexity for typos', () => {
      const options: TriageOptions = {
        issueId: 'TEST-7',
        title: 'Fix typo in README',
      };

      const result = analyzeIssue(options);

      expect(result.complexity).toBe('trivial');
      expect(result.estimatedHours).toBe(0.5);
    });

    it('should classify expert complexity for architecture work', () => {
      const options: TriageOptions = {
        issueId: 'TEST-8',
        title: 'Design new authentication system',
        description: 'Need to redesign the architecture',
      };

      const result = analyzeIssue(options);

      expect(result.complexity).toBe('expert');
      expect(result.estimatedHours).toBe(16);
    });

    it('should classify complex complexity for refactors', () => {
      const options: TriageOptions = {
        issueId: 'TEST-9',
        title: 'Refactor the entire API layer',
      };

      const result = analyzeIssue(options);

      expect(result.complexity).toBe('complex');
      expect(result.estimatedHours).toBe(8);
    });

    it('should classify medium complexity for new features', () => {
      const options: TriageOptions = {
        issueId: 'TEST-10',
        title: 'Implement new API endpoint for users',
      };

      const result = analyzeIssue(options);

      expect(result.complexity).toBe('medium');
      expect(result.estimatedHours).toBe(4);
    });

    it('should detect frontend skill from title', () => {
      const options: TriageOptions = {
        issueId: 'TEST-11',
        title: 'Build React component for user profile',
      };

      const result = analyzeIssue(options);

      expect(result.requiredSkills).toContain('frontend');
    });

    it('should detect backend skill from description', () => {
      const options: TriageOptions = {
        issueId: 'TEST-12',
        title: 'User feature',
        description: 'Need to add API endpoint on the backend',
      };

      const result = analyzeIssue(options);

      expect(result.requiredSkills).toContain('backend');
    });

    it('should detect multiple skills', () => {
      const options: TriageOptions = {
        issueId: 'TEST-13',
        title: 'Full-stack feature with database and tests',
        description: 'Build UI, API, update SQL schema, and add E2E tests',
      };

      const result = analyzeIssue(options);

      expect(result.requiredSkills).toContain('frontend');
      expect(result.requiredSkills).toContain('backend');
      expect(result.requiredSkills).toContain('database');
      expect(result.requiredSkills).toContain('testing');
    });

    it('should set needsPRD for complex work', () => {
      const options: TriageOptions = {
        issueId: 'TEST-15',
        title: 'Complex refactor of entire system',
      };

      const result = analyzeIssue(options);

      expect(result.needsPRD).toBe(true);
    });

    it('should set needsPlanning for multi-skill work', () => {
      const options: TriageOptions = {
        issueId: 'TEST-16',
        title: 'Full-stack feature',
        description: 'Frontend, backend, database, and devops changes',
      };

      const result = analyzeIssue(options);

      expect(result.needsPlanning).toBe(true);
      expect(result.requiredSkills.length).toBeGreaterThan(2);
    });

    it('should provide appropriate recommendation for P0', () => {
      const options: TriageOptions = {
        issueId: 'TEST-17',
        title: 'Production down - data loss',
      };

      const result = analyzeIssue(options);

      expect(result.recommendation).toContain('immediately');
    });

    it('should recommend PRD for unclear requirements', () => {
      const options: TriageOptions = {
        issueId: 'TEST-18',
        title: 'Feature X needs discussion',
        description: 'Requirements are unclear and TBD',
      };

      const result = analyzeIssue(options);

      expect(result.needsPRD).toBe(true);
      expect(result.recommendation).toContain('pan prd');
    });
  });

  describe('triageMultiple', () => {
    it('should process multiple issues', () => {
      const issues: TriageOptions[] = [
        { issueId: 'TEST-1', title: 'Production down' },
        { issueId: 'TEST-2', title: 'Fix typo in docs' },
        { issueId: 'TEST-3', title: 'Add new feature' },
      ];

      const results = triageMultiple(issues);

      expect(results).toHaveLength(3);
      expect(results[0].issueId).toBe('TEST-1');
      expect(results[1].issueId).toBe('TEST-2');
      expect(results[2].issueId).toBe('TEST-3');
    });

    it('should apply analyzeIssue to each item', () => {
      const issues: TriageOptions[] = [
        { issueId: 'TEST-1', title: 'Production down' },
        { issueId: 'TEST-2', title: 'Nice to have: Polish UI' },
      ];

      const results = triageMultiple(issues);

      expect(results[0].priority).toBe('P0');
      expect(results[1].priority).toBe('P4');
    });
  });

  describe('sortByPriority', () => {
    it('should sort by priority first', () => {
      const results: TriageResult[] = [
        {
          issueId: 'TEST-3',
          priority: 'P3',
          complexity: 'simple',
          estimatedHours: 2,
          requiredSkills: [],
          dependencies: [],
          needsPRD: false,
          needsPlanning: false,
          recommendation: '',
        },
        {
          issueId: 'TEST-0',
          priority: 'P0',
          complexity: 'expert',
          estimatedHours: 16,
          requiredSkills: [],
          dependencies: [],
          needsPRD: false,
          needsPlanning: false,
          recommendation: '',
        },
        {
          issueId: 'TEST-1',
          priority: 'P1',
          complexity: 'medium',
          estimatedHours: 4,
          requiredSkills: [],
          dependencies: [],
          needsPRD: false,
          needsPlanning: false,
          recommendation: '',
        },
      ];

      const sorted = sortByPriority(results);

      expect(sorted[0].issueId).toBe('TEST-0'); // P0
      expect(sorted[1].issueId).toBe('TEST-1'); // P1
      expect(sorted[2].issueId).toBe('TEST-3'); // P3
    });

    it('should sort by complexity when priority is same', () => {
      const results: TriageResult[] = [
        {
          issueId: 'TEST-2',
          priority: 'P2',
          complexity: 'complex',
          estimatedHours: 8,
          requiredSkills: [],
          dependencies: [],
          needsPRD: false,
          needsPlanning: false,
          recommendation: '',
        },
        {
          issueId: 'TEST-1',
          priority: 'P2',
          complexity: 'trivial',
          estimatedHours: 0.5,
          requiredSkills: [],
          dependencies: [],
          needsPRD: false,
          needsPlanning: false,
          recommendation: '',
        },
        {
          issueId: 'TEST-3',
          priority: 'P2',
          complexity: 'medium',
          estimatedHours: 4,
          requiredSkills: [],
          dependencies: [],
          needsPRD: false,
          needsPlanning: false,
          recommendation: '',
        },
      ];

      const sorted = sortByPriority(results);

      expect(sorted[0].issueId).toBe('TEST-1'); // trivial
      expect(sorted[1].issueId).toBe('TEST-3'); // medium
      expect(sorted[2].issueId).toBe('TEST-2'); // complex
    });

    it('should handle empty array', () => {
      const sorted = sortByPriority([]);
      expect(sorted).toEqual([]);
    });

    it('should handle single item', () => {
      const results: TriageResult[] = [
        {
          issueId: 'TEST-1',
          priority: 'P1',
          complexity: 'simple',
          estimatedHours: 2,
          requiredSkills: [],
          dependencies: [],
          needsPRD: false,
          needsPlanning: false,
          recommendation: '',
        },
      ];

      const sorted = sortByPriority(results);

      expect(sorted).toHaveLength(1);
      expect(sorted[0].issueId).toBe('TEST-1');
    });
  });
});
