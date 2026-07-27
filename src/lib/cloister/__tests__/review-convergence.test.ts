import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  evaluateReviewConvergence,
  countBlockingFindingsForRun,
  findLatestReviewRunDir,
  REVIEW_CONVERGENCE_MIN_CYCLES,
} from '../review-convergence.js';

describe('review-convergence', () => {
  describe('evaluateReviewConvergence', () => {
    it('returns converging for strictly decreasing series', () => {
      const counts = [12, 7, 5, 4, 2];
      expect(evaluateReviewConvergence(counts)).toBe('converging');
    });

    it('returns not-converging when series shows reversal at n>=3', () => {
      // [12, 7, 5, 4, 12]: last value 12 > previous 4, so it reversed
      const counts = [12, 7, 5, 4, 12];
      expect(evaluateReviewConvergence(counts)).toBe('not-converging');
    });

    it('returns not-converging for two consecutive non-decreases', () => {
      const counts = [12, 7, 5, 5, 5];
      expect(evaluateReviewConvergence(counts)).toBe('not-converging');
    });

    it('returns not-converging for flat series [5,5,5]', () => {
      const counts = [5, 5, 5];
      expect(evaluateReviewConvergence(counts)).toBe('not-converging');
    });

    it('returns converging for short series < 3', () => {
      expect(evaluateReviewConvergence([12, 13])).toBe('converging');
      expect(evaluateReviewConvergence([12])).toBe('converging');
      expect(evaluateReviewConvergence([])).toBe('converging');
    });

    it('returns converging for three-item decreasing series', () => {
      const counts = [12, 7, 5];
      expect(evaluateReviewConvergence(counts)).toBe('converging');
    });

    it('returns not-converging for three-item flat series', () => {
      const counts = [5, 5, 5];
      expect(evaluateReviewConvergence(counts)).toBe('not-converging');
    });

    it('returns converging for three-item series with one non-decrease', () => {
      const counts = [5, 5, 4];
      expect(evaluateReviewConvergence(counts)).toBe('converging');
    });
  });

  describe('countBlockingFindingsForRun', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `review-conv-test-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns synthesis.md heading count when present', () => {
      const synthesis = `
# Synthesis
## Blocking Findings
### [correctness] Issue 1
### [security] Issue 2
### [performance] Issue 3
`;
      writeFileSync(join(tempDir, 'synthesis.md'), synthesis);
      const result = countBlockingFindingsForRun(tempDir);
      expect(result).toBe(3);
    });

    it('returns 12 for fixture with 12 synthesis headings', () => {
      const headings = Array.from({ length: 12 }, (_, i) => `### [role${i}] Issue ${i + 1}`).join('\n');
      const synthesis = `
# Synthesis
## Blocking Findings
${headings}
`;
      writeFileSync(join(tempDir, 'synthesis.md'), synthesis);
      const result = countBlockingFindingsForRun(tempDir);
      expect(result).toBe(12);
    });

    it('returns 0 for empty dir with no artifacts', () => {
      const result = countBlockingFindingsForRun(tempDir);
      expect(result).toBeNull();
    });

    it('falls back to report sum when no synthesis exists', () => {
      const report1 = `
## Findings
### ! Issue A
### ! Issue B
`;
      const report2 = `
## Findings
### ⊗ Issue C
`;
      writeFileSync(join(tempDir, 'report-correctness.md'), report1);
      writeFileSync(join(tempDir, 'report-security.md'), report2);

      const result = countBlockingFindingsForRun(tempDir);
      expect(result).toBe(3);
    });

    it('prefers synthesis count over report sum', () => {
      const synthesis = `
# Synthesis
## Blocking Findings
### [role1] Issue 1
### [role2] Issue 2
`;
      const report = `
## Findings
### ! Many Issues 1
### ! Many Issues 2
### ! Many Issues 3
`;
      writeFileSync(join(tempDir, 'synthesis.md'), synthesis);
      writeFileSync(join(tempDir, 'report.md'), report);

      const result = countBlockingFindingsForRun(tempDir);
      expect(result).toBe(2);
    });
  });

  describe('findLatestReviewRunDir', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = join(tmpdir(), `review-conv-workspace-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns newest agent-*-review-* dir by mtime from .pan/review', () => {
      const panReviewDir = join(tempDir, '.pan', 'review');
      mkdirSync(panReviewDir, { recursive: true });

      const dir1 = join(panReviewDir, 'agent-123-review-1');
      const dir2 = join(panReviewDir, 'agent-456-review-2');
      mkdirSync(dir1);
      mkdirSync(dir2);

      // Modify mtimes so dir1 is newer
      writeFileSync(join(dir2, 'test.txt'), 'old', { flag: 'w' });
      writeFileSync(join(dir1, 'test.txt'), 'new', { flag: 'w' });

      const result = findLatestReviewRunDir(tempDir);
      expect(result).toBe(dir1);
    });

    it('falls back to .overdeck/review when .pan/review is absent', () => {
      const overdeckReviewDir = join(tempDir, '.overdeck', 'review');
      mkdirSync(overdeckReviewDir, { recursive: true });

      const dir = join(overdeckReviewDir, 'agent-789-review-1');
      mkdirSync(dir);

      const result = findLatestReviewRunDir(tempDir);
      expect(result).toBe(dir);
    });

    it('returns null when no review dirs exist', () => {
      const result = findLatestReviewRunDir(tempDir);
      expect(result).toBeNull();
    });

    it('ignores non-matching directory names', () => {
      const panReviewDir = join(tempDir, '.pan', 'review');
      mkdirSync(panReviewDir, { recursive: true });

      mkdirSync(join(panReviewDir, 'not-a-review-dir'));
      mkdirSync(join(panReviewDir, 'synthesis.md'));

      const result = findLatestReviewRunDir(tempDir);
      expect(result).toBeNull();
    });
  });
});
