/**
 * PAN-4433: the pure silent-reviewer detector — each classification rule, the
 * per-(run, reviewer) stall history read from the journal, and which report
 * paths count for a lane and for the parent.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PipelineJournalEntry } from '../pipeline-journal.js';
import { classifyReviewer, reviewerReportPaths, stallHistory, type SilentReviewerFacts } from '../silent-reviewer-detect.js';

const STALL_MS = 15 * 60_000;
const DISPATCHED = Date.parse('2026-09-30T12:00:00.000Z');

function facts(overrides: Partial<SilentReviewerFacts> = {}): SilentReviewerFacts {
  return {
    agentId: 'agent-pan-4383-review',
    runId: 'agent-pan-4383-review-0e9e390c',
    dispatchedAtMs: DISPATCHED,
    lastTranscriptActivityMs: null,
    reportSinceDispatch: false,
    ...overrides,
  };
}

describe('classifyReviewer', () => {
  it('a reviewer that wrote its report since the dispatch is not silent, even when old and transcript-less', () => {
    expect(classifyReviewer(facts({ reportSinceDispatch: true }), STALL_MS, DISPATCHED + 2 * STALL_MS))
      .toEqual({ silent: false, reason: 'reported' });
  });

  it('a reviewer dispatched less than stallMs ago is too young', () => {
    expect(classifyReviewer(facts(), STALL_MS, DISPATCHED + STALL_MS - 1))
      .toEqual({ silent: false, reason: 'too-young' });
  });

  it('a reviewer with no transcript stallMs after dispatch is silent', () => {
    expect(classifyReviewer(facts(), STALL_MS, DISPATCHED + STALL_MS))
      .toEqual({ silent: true, silentForMs: STALL_MS });
  });

  it('a warm-resumed reviewer whose last transcript write predates the stamp is silent', () => {
    expect(classifyReviewer(facts({ lastTranscriptActivityMs: DISPATCHED - 60_000 }), STALL_MS, DISPATCHED + 20 * 60_000))
      .toEqual({ silent: true, silentForMs: 20 * 60_000 });
  });

  it('a reviewer that wrote its transcript one second after the stamp is active', () => {
    expect(classifyReviewer(facts({ lastTranscriptActivityMs: DISPATCHED + 1_000 }), STALL_MS, DISPATCHED + 2 * STALL_MS))
      .toEqual({ silent: false, reason: 'active' });
  });

  it('a transcript write exactly at the stamp counts as active', () => {
    expect(classifyReviewer(facts({ lastTranscriptActivityMs: DISPATCHED }), STALL_MS, DISPATCHED + 2 * STALL_MS))
      .toEqual({ silent: false, reason: 'active' });
  });
});

describe('stallHistory', () => {
  const RUN = 'agent-pan-4383-review-0e9e390c';
  const REVIEWER = 'agent-pan-4383-review';

  function journal(type: PipelineJournalEntry['type'], at: string, data: Record<string, unknown>): PipelineJournalEntry {
    return { at, type, issueId: 'PAN-4383', source: 'silent-reviewer-recovery', data };
  }

  it('reports an empty history for a reviewer never re-dispatched', () => {
    expect(stallHistory([], RUN, REVIEWER)).toEqual({ stalledCount: 0, lastStalledAtMs: null, escalated: false });
  });

  it('counts stalls and escalation for the same (run, reviewer) only', () => {
    const entries = [
      journal('verification.passed', '2026-09-30T11:00:00.000Z', { head: '0e9e390c' }),
      journal('review.stalled', '2026-09-30T12:15:00.000Z', { runId: RUN, reviewer: REVIEWER }),
      journal('review.stalled', '2026-09-30T12:16:00.000Z', { runId: 'agent-pan-4383-review-11111111', reviewer: REVIEWER }),
      journal('review.stalled', '2026-09-30T12:17:00.000Z', { runId: RUN, reviewer: `${REVIEWER}-security` }),
      journal('review.stall-escalated', '2026-09-30T12:18:00.000Z', { runId: RUN, reviewer: `${REVIEWER}-security` }),
    ];

    expect(stallHistory(entries, RUN, REVIEWER)).toEqual({
      stalledCount: 1,
      lastStalledAtMs: Date.parse('2026-09-30T12:15:00.000Z'),
      escalated: false,
    });
    expect(stallHistory(entries, RUN, `${REVIEWER}-security`)).toEqual({
      stalledCount: 1,
      lastStalledAtMs: Date.parse('2026-09-30T12:17:00.000Z'),
      escalated: true,
    });
  });
});

describe('reviewerReportPaths', () => {
  const WS = '/ws/feature-pan-4383';
  const RUN = 'agent-pan-4383-review-0e9e390c';
  const DIR = join(WS, '.pan', 'review', RUN);

  it('a parent counts both review.md and synthesis.md', () => {
    expect(reviewerReportPaths({ workspace: WS, runId: RUN }).sort())
      .toEqual([join(DIR, 'review.md'), join(DIR, 'synthesis.md')]);
  });

  it('a lane counts its recorded output path, else <subRole>.md', () => {
    expect(reviewerReportPaths({ workspace: WS, runId: RUN, subRole: 'security' }))
      .toEqual([join(DIR, 'security.md')]);
    expect(reviewerReportPaths({ workspace: WS, runId: RUN, subRole: 'security', reviewOutputPath: '/elsewhere/security.md' }))
      .toEqual(['/elsewhere/security.md']);
  });
});
