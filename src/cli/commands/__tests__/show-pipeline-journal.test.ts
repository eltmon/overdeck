/**
 * `pan show`'s pipeline block — one line per journal entry.
 *
 * The summary is the only thing that turns a raw entry into something an
 * operator reads at a glance, so it is tested directly; the printing around it
 * is three `console.log` calls.
 */
import { describe, expect, it } from 'vitest';

import type { PipelineJournalEntry } from '../../../lib/cloister/pipeline-journal.js';
import { summarizePipelineEntry } from '../show.js';

function entry(
  type: PipelineJournalEntry['type'],
  data?: Record<string, unknown>,
  source?: string,
): PipelineJournalEntry {
  return {
    at: '2026-09-19T12:34:56.000Z',
    type,
    issueId: 'PAN-3705',
    ...(source ? { source } : {}),
    ...(data ? { data } : {}),
  };
}

describe('summarizePipelineEntry', () => {
  it('shows the verified head, truncated', () => {
    expect(summarizePipelineEntry(entry('verification.passed', { head: 'a7b64f7c0000' })))
      .toBe('head=a7b64f7c');
    expect(summarizePipelineEntry(entry('verification.started', { head: 'a7b64f7c' })))
      .toBe('head=a7b64f7c');
  });

  it('names the failing check and the attempt', () => {
    expect(summarizePipelineEntry(entry('verification.failed', { failedCheck: 'lint', cycleCount: 2 })))
      .toBe('lint (attempt 2)');
  });

  it('names who asked for the review', () => {
    expect(summarizePipelineEntry(entry('review.requested', undefined, 'pan-done'))).toBe('pan-done');
  });

  it('counts reviewers and names the run', () => {
    expect(summarizePipelineEntry(entry('review.dispatched', {
      runId: '80c53e47-1111-2222-3333-444455556666',
      reviewers: ['a', 'b', 'c'],
      launched: 3,
    }))).toBe('3 reviewers (run 80c53e47)');
  });

  it('gives a re-dispatch its reason', () => {
    expect(summarizePipelineEntry(entry('review.redispatched', { launched: 2, reason: 'no live reviewer' })))
      .toBe('2 reviewers — no live reviewer');
  });

  it('shows the verdict and the role that posted it', () => {
    expect(summarizePipelineEntry(entry('review.verdict', { verdict: 'APPROVED', subRole: 'review' })))
      .toBe('APPROVED (review)');
  });

  it('shows merge outcomes', () => {
    expect(summarizePipelineEntry(entry('merge.attempted', { kind: 'normal' }))).toBe('normal');
    expect(summarizePipelineEntry(entry('merge.failed', { reason: 'CI checks failing' }))).toBe('CI checks failing');
  });

  it('is empty rather than noisy when an entry carries no data', () => {
    expect(summarizePipelineEntry(entry('merge.completed'))).toBe('');
    expect(summarizePipelineEntry(entry('verification.passed'))).toBe('');
  });
});
