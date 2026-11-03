/**
 * PAN-4849 WI-20: Deft's review cycle rebuilt from Greptile comments, check
 * runs and fix-batch commits, against a hand-written golden.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countSeverities, deriveDeftReviewCycle, type DeftReviewCycleInput } from '../review-cycle.js';

const load = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));
const MAIN: DeftReviewCycleInput = load('review-cycle/main.json');
const NOT_RUNNING: DeftReviewCycleInput = load('review-cycle/not-running.json');
const GOLDEN = load('review-cycle.golden.json');
const NOW = Date.parse('2026-11-02T18:00:00Z');

/** MAIN with the rolling summary's body replaced. */
function withSummary(body: string): DeftReviewCycleInput {
  return {
    ...MAIN,
    discussions: MAIN.discussions.map(item =>
      item.author === 'greptile-apps[bot]' && item.source === 'github-pr-conversation' ? { ...item, body } : item),
  };
}

describe('deriveDeftReviewCycle', () => {
  it('rebuilds the main fixture into the golden view model', () => {
    expect(deriveDeftReviewCycle(MAIN, NOW)).toEqual(GOLDEN);
  });

  it('is CLEAN when the summary at head has no blocking findings', () => {
    const clean = deriveDeftReviewCycle(withSummary(
      'Confidence Score: 5/5\n\nLast reviewed commit: [x](https://github.com/o/r/commit/abc1234)',
    ), NOW);
    expect(clean.verdict).toBe('CLEAN');
    expect(clean.exit).toMatchObject({ noBlocking: 'met', confidence: 'met', p0p1Remaining: 0 });
  });

  it('is PENDING when Greptile has not reviewed the head yet', () => {
    const stale = deriveDeftReviewCycle(withSummary(
      'Confidence Score: 3/5\n<img alt="P0" src="x"/>\nLast reviewed commit: [x](https://github.com/o/r/commit/9999999)',
    ), NOW);
    expect(stale.verdict).toBe('PENDING');
    expect(stale.exit).toMatchObject({ lastReviewedCommit: 'unmet', confidence: 'unmet', noBlocking: 'unmet' });
  });

  it('reports NO_REVIEWER_INSTALLED with no rounds when no supported reviewer exists', () => {
    const result = deriveDeftReviewCycle(NOT_RUNNING, NOW);
    expect(result).toMatchObject({
      verdict: 'NO_REVIEWER_INSTALLED',
      rounds: [],
      reviewer: { present: false, name: null, source: 'none', unsupported: ['CodeRabbit'] },
    });
  });

  it('treats an empty policy reviewer list as no reviewer, even with Greptile comments', () => {
    const result = deriveDeftReviewCycle({ ...MAIN, state: { ...MAIN.state, policy: { ...MAIN.state.policy, reviewers: [] } } }, NOW);
    expect(result).toMatchObject({ verdict: 'NO_REVIEWER_INSTALLED', rounds: [], reviewer: { present: false, source: 'policy' } });
  });

  it('marks an expired or ended lease inactive', () => {
    expect(deriveDeftReviewCycle(MAIN, Date.parse('2026-11-02T18:30:00Z')).lease?.active).toBe(false);
  });
});

describe('countSeverities', () => {
  it('counts badges, bold labels and headings, and ignores fenced code and negated labels', () => {
    const body = [
      '<img alt="P0" src="x"/> one',
      '- **P1: race in the poller**',
      '**P0: none**',
      '## P1 · unbounded read',
      '**P2** style nit',
      '```',
      '**P0** inside a fence',
      '```',
    ].join('\n');
    expect(countSeverities(body)).toEqual({ p0: 1, p1: 2, p2: 1 });
  });
});
