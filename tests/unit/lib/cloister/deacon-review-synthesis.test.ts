/**
 * PAN-1864: synthesizeReviewFromReports — the deterministic deacon-side review
 * synthesis. When a convoy synthesis parent is wedged, the deacon reads the
 * on-disk reviewer reports and derives the verdict itself: BLOCK if any report
 * carries a blocking finding (`### !` / `### ⊗` heading inside `## Findings`),
 * otherwise PASS. No dependency on a live LLM parent.
 */
import { describe, it, expect } from 'vitest';
import { synthesizeReviewFromReports } from '../../../../src/lib/cloister/deacon-review-signals.js';
import type { ReviewSubRole } from '../../../../src/lib/cloister/review-monitor.js';

function report(subRole: ReviewSubRole, findings: string): { subRole: ReviewSubRole; path: string; body: string } {
  return {
    subRole,
    path: `/tmp/review/run-1/${subRole}.md`,
    body: [
      `# Review — ${subRole}`,
      '',
      '## Summary',
      'Reviewed the diff.',
      '',
      '## Findings',
      findings,
      '',
      '## Notes',
      'Advisory context lives here.',
    ].join('\n'),
  };
}

const CLEAN = 'None.';

describe('synthesizeReviewFromReports (PAN-1864 deterministic synthesis)', () => {
  it('passes when all four reports are clean', () => {
    const result = synthesizeReviewFromReports({
      issueId: 'PAN-9999',
      reviewDir: '/tmp/review/run-1',
      reports: [
        report('security', CLEAN),
        report('correctness', CLEAN),
        report('performance', CLEAN),
        report('requirements', CLEAN),
      ],
    });

    expect(result.verdict).toBe('passed');
    expect(result.topBlocker).toBe('');
    expect(result.body).toContain('## Verdict: APPROVED');
    expect(result.body).toContain('## Blocking Findings\nNone');
  });

  it('blocks when one report carries a `### !` blocker and surfaces it as topBlocker', () => {
    const result = synthesizeReviewFromReports({
      issueId: 'PAN-9999',
      reviewDir: '/tmp/review/run-1',
      reports: [
        report('security', '### ! SQL injection in workspace route\nUser input reaches the query.'),
        report('correctness', CLEAN),
        report('performance', CLEAN),
        report('requirements', CLEAN),
      ],
    });

    expect(result.verdict).toBe('blocked');
    expect(result.topBlocker).toBe('[security] SQL injection in workspace route');
    expect(result.body).toContain('CHANGES REQUESTED — [security] SQL injection in workspace route');
    expect(result.body).toContain('### [security] SQL injection in workspace route');
  });

  it('recognizes the ⊗ blocker heading variant', () => {
    const result = synthesizeReviewFromReports({
      issueId: 'PAN-9999',
      reviewDir: '/tmp/review/run-1',
      reports: [
        report('security', CLEAN),
        report('correctness', '### ⊗ Off-by-one in patrol cooldown\nBoundary never fires.'),
        report('performance', CLEAN),
        report('requirements', CLEAN),
      ],
    });

    expect(result.verdict).toBe('blocked');
    expect(result.topBlocker).toBe('[correctness] Off-by-one in patrol cooldown');
  });

  it('does not block on advisory findings headings without the blocker marker', () => {
    const result = synthesizeReviewFromReports({
      issueId: 'PAN-9999',
      reviewDir: '/tmp/review/run-1',
      reports: [
        report('security', '### Consider rate-limiting the endpoint\nNice-to-have hardening.'),
        report('correctness', CLEAN),
        report('performance', '### Cache the lookup\nMinor win.'),
        report('requirements', CLEAN),
      ],
    });

    expect(result.verdict).toBe('passed');
    expect(result.topBlocker).toBe('');
  });

  it('ignores blocker-style headings outside the Findings section', () => {
    const body = [
      '# Review — security',
      '',
      '## Findings',
      'None.',
      '',
      '## Appendix',
      '### ! Example of what a blocker heading looks like',
      'Documentation only.',
    ].join('\n');

    const result = synthesizeReviewFromReports({
      issueId: 'PAN-9999',
      reviewDir: '/tmp/review/run-1',
      reports: [
        { subRole: 'security', path: '/tmp/review/run-1/security.md', body },
        report('correctness', CLEAN),
        report('performance', CLEAN),
        report('requirements', CLEAN),
      ],
    });

    expect(result.verdict).toBe('passed');
  });

  it('lists every blocker across reports and keeps clean sub-roles separate', () => {
    const result = synthesizeReviewFromReports({
      issueId: 'PAN-9999',
      reviewDir: '/tmp/review/run-1',
      reports: [
        report('security', '### ! Token logged in plaintext\nLeaks to the transcript.'),
        report('correctness', '### ! Verdict written before reports read\nRace on patrol.\n\n### ⊗ Cooldown map never pruned\nUnbounded growth.'),
        report('performance', CLEAN),
        report('requirements', CLEAN),
      ],
    });

    expect(result.verdict).toBe('blocked');
    expect(result.topBlocker).toBe('[security] Token logged in plaintext');
    expect(result.body).toContain('### [security] Token logged in plaintext');
    expect(result.body).toContain('### [correctness] Verdict written before reports read');
    expect(result.body).toContain('### [correctness] Cooldown map never pruned');
    expect(result.body).toContain('- performance');
    expect(result.body).toContain('- requirements');
  });
});
