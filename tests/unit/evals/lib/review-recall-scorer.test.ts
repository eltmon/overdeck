import { describe, expect, it } from 'vitest';
import {
  findingMatchesBlocker,
  parseFindings,
  parseReviewRecallCase,
  scoreReviewRecall,
  type ReviewRecallCase,
} from '../../../../evals/lib/review-recall-scorer.js';

function reviewCase(overrides: Partial<ReviewRecallCase> = {}): ReviewRecallCase {
  return {
    id: '4385-vault-git-lock',
    lane: 'correctness',
    provenance: {
      pr: 4385,
      reviewedSha: 'a'.repeat(40),
      mergeBase: 'b'.repeat(40),
      commentUrl: 'https://github.com/eltmon/overdeck/pull/4385#issuecomment-1',
    },
    issue: { id: 'PAN-2609', title: 'Vault store', acceptanceCriteria: [] },
    diff: 'diff --git a/src/lib/vault/store/git.ts b/src/lib/vault/store/git.ts\n+code\n',
    blocker: {
      title: 'The git backend has no cross-process lock',
      file: 'src/lib/vault/store/git.ts',
      lines: [252],
      keywords: ['lock', 'concurrent', 'settlement'],
    },
    ...overrides,
  };
}

const MIXED_REPORT = `# Correctness Review - 2026-09-29

## Summary
Two blockers, three advisories.

## Findings

### ! Concurrent settlements corrupt the ledger — \`src/lib/vault/store/git.ts:262\`
**Problem:** no lock around the read-modify-write.

### ⊗ Sync fs call in a server route — \`./src/lib/vault/routes.ts:10\`
**Problem:** readFileSync blocks the event loop.

## Non-blocking Notes

### ~ Missing null check — \`src/lib/vault/a.ts:3\`
Edge case.

### ≉ Small inefficiency — \`src/lib/vault/b.ts\`
Minor.

### ? Maybe cache — \`src/lib/vault/c.ts:9\`
Optional.
`;

describe('evals/lib/review-recall-scorer', () => {
  describe('parseFindings', () => {
    it('marks ! and ⊗ as blocking and ~, ≉, ? as non-blocking, parsing file and line', () => {
      const findings = parseFindings(MIXED_REPORT);
      expect(findings.map((f) => [f.glyph, f.blocking, f.file, f.line])).toEqual([
        ['!', true, 'src/lib/vault/store/git.ts', 262],
        ['⊗', true, './src/lib/vault/routes.ts', 10],
        ['~', false, 'src/lib/vault/a.ts', 3],
        ['≉', false, 'src/lib/vault/b.ts', null],
        ['?', false, 'src/lib/vault/c.ts', 9],
      ]);
      expect(findings[0]!.title).toBe('Concurrent settlements corrupt the ledger');
      expect(findings[0]!.body).toContain('no lock around the read-modify-write');
      expect(findings[0]!.body).not.toContain('Sync fs call');
    });

    it('takes the location from the body when the heading names a requirement source', () => {
      const report = `## Findings

### ! Required docs line is wrong — AC-3
**Scope:** in_pr_scope
**Observed:** \`docs/MODEL-CALLS.md:57\` points at the wrong line.
`;
      const [finding] = parseFindings(report);
      expect(finding).toMatchObject({ blocking: true, file: 'docs/MODEL-CALLS.md', line: 57 });
      expect(finding!.title).toBe('Required docs line is wrong — AC-3');
    });

    it('returns no findings for a report whose Findings section is None', () => {
      expect(parseFindings('# Review\n\n## Findings\n\nNone\n')).toEqual([]);
    });
  });

  describe('findingMatchesBlocker', () => {
    it('matches on the same file within the line window', () => {
      const [finding] = parseFindings(MIXED_REPORT);
      expect(findingMatchesBlocker(finding!, reviewCase().blocker)).toBe(true);
    });

    it('matches on keyword hits when the cited line is far away', () => {
      const report = '### ! Settlement race — `src/lib/vault/store/git.ts:900`\nConcurrent writers and no lock.\n';
      const [finding] = parseFindings(report);
      expect(findingMatchesBlocker(finding!, reviewCase().blocker)).toBe(true);
    });

    it('rejects a far line with fewer than two keyword hits, and a different file', () => {
      const far = parseFindings('### ! Something else — `src/lib/vault/store/git.ts:900`\nOnly a lock mention.\n')[0]!;
      expect(findingMatchesBlocker(far, reviewCase().blocker)).toBe(false);
      const other = parseFindings('### ! Race — `src/lib/vault/store/sqlite.ts:252`\nlock concurrent\n')[0]!;
      expect(findingMatchesBlocker(other, reviewCase().blocker)).toBe(false);
    });
  });

  describe('scoreReviewRecall', () => {
    it('returns recall 1 when a blocking finding cites the blocker file 10 lines away', () => {
      const report = '## Findings\n\n### ! Ledger race — `src/lib/vault/store/git.ts:242`\nDetails.\n';
      expect(scoreReviewRecall(report, reviewCase())).toEqual({ recall: 1, precision: 1, blockingCount: 1, score: 1 });
    });

    it('returns recall 0 when the same finding is non-blocking', () => {
      const report = '## Non-blocking Notes\n\n### ~ Ledger race — `src/lib/vault/store/git.ts:242`\nDetails.\n';
      expect(scoreReviewRecall(report, reviewCase())).toEqual({ recall: 0, precision: null, blockingCount: 0, score: 0 });
    });

    it('returns precision 0.5 when one of two blocking findings matches', () => {
      expect(scoreReviewRecall(MIXED_REPORT, reviewCase())).toEqual({ recall: 1, precision: 0.5, blockingCount: 2, score: 1 });
    });

    it('returns precision null, recall 0 and no blocking findings for a None report', () => {
      expect(scoreReviewRecall('## Findings\n\nNone', reviewCase())).toEqual({
        recall: 0,
        precision: null,
        blockingCount: 0,
        score: 0,
      });
    });
  });

  describe('parseReviewRecallCase', () => {
    it('accepts a valid case', () => {
      expect(parseReviewRecallCase(reviewCase()).id).toBe('4385-vault-git-lock');
    });

    it('rejects a requirements-lane case with no acceptance criteria', () => {
      expect(() => parseReviewRecallCase(reviewCase({ lane: 'requirements' }))).toThrow(/at least one acceptance criterion/);
    });

    it('rejects a diff over 60,000 chars and a security lane', () => {
      expect(() => parseReviewRecallCase(reviewCase({ diff: 'x'.repeat(60_001) }))).toThrow(/over 60000/);
      expect(() => parseReviewRecallCase({ ...reviewCase(), lane: 'security' })).toThrow(/lane must be one of/);
    });
  });
});
