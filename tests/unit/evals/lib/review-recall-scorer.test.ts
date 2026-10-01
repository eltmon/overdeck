import { describe, expect, it } from 'vitest';
import { loadFixtureDir } from '../../../../evals/lib/fixtures.js';
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

  // Glyph bullets and every-citation matching (PAN-4406): the run's Opus 5.5 rep-1 report for
  // case 4284 found the blocker as a `~` bullet citing only the basename, and scored 0.
  describe('glyph bullets and citations (PAN-4406)', () => {
    const OPUS_4284_REPORT = `## Non-blocking Notes

- **~ A stale registry entry can keep messages held after the pane clears (in_pr_scope, AC3).**
  - The test "feed row carries a non-answerable pendingPermission for a registry-only entry" uses \`permission-answered.txt\`. There, the pane shows the prompt answered, yet the feed still reports \`pendingPermission\` (\`answerable: false\`).
  - The hook treats any truthy \`pendingPermission\` as blocking (\`useHeldMessageRelease.ts:28-29\`). Held messages therefore stay held until the registry entry is cleared, not when "the prompt clears."

- **~ Hook mount point not visible (in_pr_scope, AC3 wiring).**
  - \`useHeldMessageRelease\` is not mounted in the excerpt.
`;
    const blocker4284: ReviewRecallCase['blocker'] = {
      title: 'A stale registry entry keeps messages held',
      file: 'src/dashboard/frontend/src/App/hooks/useHeldMessageRelease.ts',
      lines: [31, 38],
      keywords: ['registry', 'held', 'pendingpermission'],
    };

    it('parses glyph bullets as non-blocking findings and matches the blocker through any body citation', () => {
      const findings = parseFindings(OPUS_4284_REPORT);
      expect(findings.map((f) => [f.glyph, f.blocking])).toEqual([
        ['~', false],
        ['~', false],
      ]);
      expect(findings[0]!.citations).toContainEqual({ file: 'useHeldMessageRelease.ts', line: 28 });
      // The first body citation is permission-answered.txt; matching still checks every citation.
      expect(findings[0]!.citations[0]).toEqual({ file: 'permission-answered.txt', line: null });
      expect(findingMatchesBlocker(findings[0]!, blocker4284, { minKeywordHits: 99 })).toBe(true);
      expect(findings[1]!.body).toContain('is not mounted in the excerpt');
      expect(findings[0]!.body).not.toContain('is not mounted in the excerpt');
    });

    it('parses a Sonnet-style backticked-glyph bullet as non-blocking with its inline citation', () => {
      const report =
        '- `≉` **Path setup moved earlier** — `getProjectPath` now runs for every request (`src/dashboard/server/routes/workspaces.ts:3668`).\n';
      const [finding] = parseFindings(report);
      expect(finding).toMatchObject({
        glyph: '≉',
        blocking: false,
        file: 'src/dashboard/server/routes/workspaces.ts',
        line: 3668,
      });
      expect(finding!.title.startsWith('Path setup moved earlier')).toBe(true);
    });

    it('does not count a list item inside a heading finding as a second finding', () => {
      const report = '### ! Race — `src/lib/vault/store/git.ts:262`\n- ~ a nested note\n\n## Non-blocking Notes\n\n- ~ Separate note\n';
      expect(parseFindings(report).map((f) => [f.glyph, f.blocking, f.title])).toEqual([
        ['!', true, 'Race'],
        ['~', false, 'Separate note'],
      ]);
    });

    it('matches a shortened path only on a segment boundary that keeps the basename', () => {
      const blocker = { ...reviewCase().blocker, file: 'src/a/useX.ts', lines: [10] };
      const matches = (cited: string) =>
        findingMatchesBlocker(parseFindings(`- ~ Note — \`${cited}:10\`\n`)[0]!, blocker, { minKeywordHits: 99 });
      expect(matches('useX.ts')).toBe(true);
      expect(matches('a/useX.ts')).toBe(true);
      expect(matches('X.ts')).toBe(false);
      const dirBlocker = { ...blocker, file: 'src/hooks' };
      expect(findingMatchesBlocker(parseFindings('- ~ Note — `hooks:10`\n')[0]!, dirBlocker)).toBe(false);
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

  describe('committed fixtures', () => {
    const cases = loadFixtureDir('evals/fixtures/review-recall').map((f) => parseReviewRecallCase(f.data));

    it('holds 12 to 20 cases, none in the security lane, with at least 2 per scored lane', () => {
      expect(cases.length).toBeGreaterThanOrEqual(12);
      expect(cases.length).toBeLessThanOrEqual(20);
      for (const lane of ['correctness', 'performance', 'requirements'] as const) {
        expect(cases.filter((c) => c.lane === lane).length).toBeGreaterThanOrEqual(2);
      }
    });

    it('records provenance pointing at an eltmon/overdeck pull request comment', () => {
      for (const c of cases) {
        expect(c.id.startsWith(`${c.provenance.pr}-`)).toBe(true);
        expect(c.provenance.commentUrl).toMatch(new RegExp(`^https://github\\.com/eltmon/overdeck/pull/${c.provenance.pr}#issuecomment-\\d+$`));
        expect(c.provenance.reviewedSha).toMatch(/^[0-9a-f]{40}$/);
        expect(c.provenance.mergeBase).toMatch(/^[0-9a-f]{40}$/);
        expect(c.diff).toContain(`diff --git a/${c.blocker.file} `);
        // Committed diffs stay small so the branch diff fits the verification gate's git buffer.
        expect(c.diff.length, c.id).toBeLessThanOrEqual(15_000);
      }
    });

    it('scores recall 1 for each case when its own blocker is reported as a canonical heading', () => {
      for (const c of cases) {
        const report = `## Findings\n\n### ! ${c.blocker.title} — \`${c.blocker.file}:${c.blocker.lines[0]}\`\n`;
        expect(scoreReviewRecall(report, c).recall, c.id).toBe(1);
      }
    });
  });
});
