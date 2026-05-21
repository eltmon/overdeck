import { describe, expect } from 'vitest';
import { it } from '@effect/vitest';
import { Effect } from 'effect';
import { analyzeIssue, triageMultiple, sortByPriority } from '../../../src/lib/planning/triage-agent.js';
import type { TriageOptions, TriageResult } from '../../../src/lib/planning/triage-agent.js';

describe('triage-agent', () => {
  describe('analyzeIssue', () => {
    it.effect('should classify P0 for production outages', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-1',
          title: 'Production is down',
          description: 'Users cannot access the site',
        };

        const result = yield* analyzeIssue(options);

        expect(result.priority).toBe('P0');
        expect(result.issueId).toBe('TEST-1');
      })
    );

    it.effect('should classify P0 for security vulnerabilities', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-2',
          title: 'Security vulnerability in auth system',
        };

        const result = yield* analyzeIssue(options);

        expect(result.priority).toBe('P0');
      })
    );

    it.effect('should classify P1 for critical bugs', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-3',
          title: 'Critical: Users cannot login',
          description: 'Login form is broken',
        };

        const result = yield* analyzeIssue(options);

        expect(result.priority).toBe('P1');
      })
    );

    it.effect('should classify P2 for important features', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-4',
          title: 'Important: Add user analytics',
          labels: ['high'],
        };

        const result = yield* analyzeIssue(options);

        expect(result.priority).toBe('P2');
      })
    );

    it.effect('should classify P4 for nice-to-have enhancements', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-5',
          title: 'Nice to have: Polish the UI animations',
        };

        const result = yield* analyzeIssue(options);

        expect(result.priority).toBe('P4');
      })
    );

    it.effect('should use Linear priority when provided', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-6',
          title: 'Some task',
          currentPriority: 2,
        };

        const result = yield* analyzeIssue(options);

        expect(result.priority).toBe('P2');
      })
    );

    it.effect('should classify trivial complexity for typos', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-7',
          title: 'Fix typo in README',
        };

        const result = yield* analyzeIssue(options);

        expect(result.complexity).toBe('trivial');
        expect(result.estimatedHours).toBe(0.5);
      })
    );

    it.effect('should classify expert complexity for architecture work', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-8',
          title: 'Design new authentication system',
          description: 'Need to redesign the architecture',
        };

        const result = yield* analyzeIssue(options);

        expect(result.complexity).toBe('expert');
        expect(result.estimatedHours).toBe(16);
      })
    );

    it.effect('should classify complex complexity for refactors', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-9',
          title: 'Refactor the entire API layer',
        };

        const result = yield* analyzeIssue(options);

        expect(result.complexity).toBe('complex');
        expect(result.estimatedHours).toBe(8);
      })
    );

    it.effect('should classify medium complexity for new features', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-10',
          title: 'Implement new API endpoint for users',
        };

        const result = yield* analyzeIssue(options);

        expect(result.complexity).toBe('medium');
        expect(result.estimatedHours).toBe(4);
      })
    );

    it.effect('should detect frontend skill from title', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-11',
          title: 'Build React component for user profile',
        };

        const result = yield* analyzeIssue(options);

        expect(result.requiredSkills).toContain('frontend');
      })
    );

    it.effect('should detect backend skill from description', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-12',
          title: 'User feature',
          description: 'Need to add API endpoint on the backend',
        };

        const result = yield* analyzeIssue(options);

        expect(result.requiredSkills).toContain('backend');
      })
    );

    it.effect('should detect multiple skills', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-13',
          title: 'Full-stack feature with database and tests',
          description: 'Build UI, API, update SQL schema, and add E2E tests',
        };

        const result = yield* analyzeIssue(options);

        expect(result.requiredSkills).toContain('frontend');
        expect(result.requiredSkills).toContain('backend');
        expect(result.requiredSkills).toContain('database');
        expect(result.requiredSkills).toContain('testing');
      })
    );

    it.effect('should set needsPRD for complex work', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-15',
          title: 'Complex refactor of entire system',
        };

        const result = yield* analyzeIssue(options);

        expect(result.needsPRD).toBe(true);
      })
    );

    it.effect('should set needsPlanning for multi-skill work', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-16',
          title: 'Full-stack feature',
          description: 'Frontend, backend, database, and devops changes',
        };

        const result = yield* analyzeIssue(options);

        expect(result.needsPlanning).toBe(true);
        expect(result.requiredSkills.length).toBeGreaterThan(2);
      })
    );

    it.effect('should provide appropriate recommendation for P0', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-17',
          title: 'Production down - data loss',
        };

        const result = yield* analyzeIssue(options);

        expect(result.recommendation).toContain('immediately');
      })
    );

    it.effect('should recommend PRD for unclear requirements', () =>
      Effect.gen(function* () {
        const options: TriageOptions = {
          issueId: 'TEST-18',
          title: 'Feature X needs discussion',
          description: 'Requirements are unclear and TBD',
        };

        const result = yield* analyzeIssue(options);

        expect(result.needsPRD).toBe(true);
        expect(result.recommendation).toContain('pan prd');
      })
    );
  });

  describe('triageMultiple', () => {
    it.effect('should process multiple issues', () =>
      Effect.gen(function* () {
        const issues: TriageOptions[] = [
          { issueId: 'TEST-1', title: 'Production down' },
          { issueId: 'TEST-2', title: 'Fix typo in docs' },
          { issueId: 'TEST-3', title: 'Add new feature' },
        ];

        const results = yield* triageMultiple(issues);

        expect(results).toHaveLength(3);
        expect(results[0].issueId).toBe('TEST-1');
        expect(results[1].issueId).toBe('TEST-2');
        expect(results[2].issueId).toBe('TEST-3');
      })
    );

    it.effect('should apply analyzeIssue to each item', () =>
      Effect.gen(function* () {
        const issues: TriageOptions[] = [
          { issueId: 'TEST-1', title: 'Production down' },
          { issueId: 'TEST-2', title: 'Nice to have: Polish UI' },
        ];

        const results = yield* triageMultiple(issues);

        expect(results[0].priority).toBe('P0');
        expect(results[1].priority).toBe('P4');
      })
    );
  });

  describe('sortByPriority', () => {
    it.effect('should sort by priority first', () =>
      Effect.gen(function* () {
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

        const sorted = yield* sortByPriority(results);

        expect(sorted[0].issueId).toBe('TEST-0'); // P0
        expect(sorted[1].issueId).toBe('TEST-1'); // P1
        expect(sorted[2].issueId).toBe('TEST-3'); // P3
      })
    );

    it.effect('should sort by complexity when priority is same', () =>
      Effect.gen(function* () {
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

        const sorted = yield* sortByPriority(results);

        expect(sorted[0].issueId).toBe('TEST-1'); // trivial
        expect(sorted[1].issueId).toBe('TEST-3'); // medium
        expect(sorted[2].issueId).toBe('TEST-2'); // complex
      })
    );

    it.effect('should handle empty array', () =>
      Effect.gen(function* () {
        const sorted = yield* sortByPriority([]);
        expect(sorted).toEqual([]);
      })
    );

    it.effect('should handle single item', () =>
      Effect.gen(function* () {
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

        const sorted = yield* sortByPriority(results);

        expect(sorted).toHaveLength(1);
        expect(sorted[0].issueId).toBe('TEST-1');
      })
    );
  });
});
