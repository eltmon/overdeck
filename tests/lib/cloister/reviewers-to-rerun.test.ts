import { describe, it, expect } from 'vitest';
import { reviewersToRerun, type PriorVerdict } from '../../../src/lib/cloister/reviewers-to-rerun.js';
import type { ReviewSubRole } from '../../../src/lib/cloister/review-monitor.js';

const PASSED: PriorVerdict = { status: 'passed', atCommit: 'abc123' };
const BLOCKED: PriorVerdict = { status: 'blocked', atCommit: 'abc123' };

describe('reviewersToRerun', () => {
  describe("scope='all'", () => {
    it('returns all four sub-roles regardless of changed files or prior verdicts', () => {
      const result = reviewersToRerun('all', [], {});
      expect(result).toEqual(['security', 'correctness', 'performance', 'requirements']);
    });

    it('returns all four even when no files changed and all passed', () => {
      const result = reviewersToRerun('all', [], {
        security: PASSED,
        correctness: PASSED,
        performance: PASSED,
        requirements: PASSED,
      });
      expect(result).toEqual(['security', 'correctness', 'performance', 'requirements']);
    });
  });

  describe("scope='blockers'", () => {
    it('returns only the prior-blocked sub-roles', () => {
      const result = reviewersToRerun('blockers', ['src/foo.ts'], {
        security: BLOCKED,
        correctness: PASSED,
        performance: PASSED,
        requirements: BLOCKED,
      });
      expect(result).toEqual(['security', 'requirements']);
    });

    it('returns empty list when no prior verdicts are blocked', () => {
      const result = reviewersToRerun('blockers', ['src/foo.ts'], {
        security: PASSED,
        correctness: PASSED,
        performance: PASSED,
        requirements: PASSED,
      });
      expect(result).toEqual([]);
    });

    it('returns empty list when priorVerdicts is empty', () => {
      const result = reviewersToRerun('blockers', ['src/foo.ts'], {});
      expect(result).toEqual([]);
    });
  });

  describe("scope='changed'", () => {
    it('always includes correctness and requirements when any file changed', () => {
      const result = reviewersToRerun('changed', ['src/lib/some-random-file.ts'], {});
      expect(result).toContain('correctness');
      expect(result).toContain('requirements');
    });

    it('returns empty list when no files changed and no prior blockers', () => {
      const result = reviewersToRerun('changed', [], {});
      expect(result).toEqual([]);
    });

    it('includes security when a changed file matches a security pattern (auth)', () => {
      const result = reviewersToRerun('changed', ['src/lib/auth/middleware.ts'], {});
      expect(result).toContain('security');
    });

    it('includes security when a changed file matches crypto pattern', () => {
      const result = reviewersToRerun('changed', ['src/lib/crypto-utils.ts'], {});
      expect(result).toContain('security');
    });

    it('includes security when a dependency manifest changed', () => {
      const result = reviewersToRerun('changed', ['package.json'], {});
      expect(result).toContain('security');
    });

    it('includes security when bun.lock changed', () => {
      const result = reviewersToRerun('changed', ['bun.lock'], {});
      expect(result).toContain('security');
    });

    it('does NOT include security when an unrelated file changes', () => {
      const result = reviewersToRerun('changed', ['src/lib/formatting/dates.ts'], {});
      expect(result).not.toContain('security');
    });

    it('includes performance when a changed file is in the database layer', () => {
      const result = reviewersToRerun('changed', ['src/lib/database/schema.ts'], {});
      expect(result).toContain('performance');
    });

    it('includes performance when a changed file is in the dashboard server routes', () => {
      const result = reviewersToRerun('changed', ['src/dashboard/server/routes/agents.ts'], {});
      expect(result).toContain('performance');
    });

    it('does NOT include performance when an unrelated file changes', () => {
      const result = reviewersToRerun('changed', ['src/lib/formatting/strings.ts'], {});
      expect(result).not.toContain('performance');
    });

    it('includes a reviewer that blocked last cycle under every scope regardless of files (NFR-1)', () => {
      // blockers always included — even with no changed files in their domain
      const resultChanged = reviewersToRerun('changed', [], { performance: BLOCKED });
      expect(resultChanged).toContain('performance');

      const resultBlockers = reviewersToRerun('blockers', [], { performance: BLOCKED });
      expect(resultBlockers).toContain('performance');

      const resultAll = reviewersToRerun('all', [], { performance: BLOCKED });
      expect(resultAll).toContain('performance');
    });

    it('preserves canonical ordering [security, correctness, performance, requirements]', () => {
      // All 4 included
      const result = reviewersToRerun('changed', ['src/lib/database/auth.ts', 'package.json'], {
        security: BLOCKED,
      });
      const indices = (['security', 'correctness', 'performance', 'requirements'] as ReviewSubRole[])
        .filter(r => result.includes(r))
        .map(r => result.indexOf(r));
      // Indices should be non-decreasing (sorted)
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i - 1]);
      }
    });

    it('includes security when a prior-blocked security reviewer exists (NFR-1)', () => {
      // Even with no security-pattern files, blocked last cycle means include
      const result = reviewersToRerun('changed', ['src/lib/formatting/strings.ts'], { security: BLOCKED });
      expect(result).toContain('security');
    });
  });
});
