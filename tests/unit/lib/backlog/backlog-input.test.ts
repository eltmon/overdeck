import { describe, it, expect } from 'vitest';
import { normalizeBacklogIssues } from '../../../../src/lib/backlog/backlog-input.js';

/**
 * Regression for PAN-1866: the sequencer was fed dashboard read-model issue
 * objects (keyed by `identifier`, with canonical statuses) but read `issue.ref`,
 * so `getReviewStatusSync(issue.ref)` received `undefined` and crashed on
 * `undefined.toUpperCase()` — every "Run creation pass" died before spawning.
 * normalizeBacklogIssues adapts the dashboard shape into tracker `Issue` objects.
 */
describe('normalizeBacklogIssues', () => {
  it('maps the dashboard `identifier` onto `ref` (never undefined)', () => {
    const [issue] = normalizeBacklogIssues([
      { identifier: 'PAN-302', title: 'x', canonicalStatus: 'todo' },
    ]);
    expect(issue!.ref).toBe('PAN-302');
    expect(typeof issue!.ref).toBe('string');
  });

  it('maps canonical statuses onto the IssueState union', () => {
    const byRef = Object.fromEntries(
      normalizeBacklogIssues([
        { identifier: 'PAN-1', canonicalStatus: 'todo' },
        { identifier: 'PAN-2', canonicalStatus: 'backlog' },
        { identifier: 'PAN-3', canonicalStatus: 'in_progress' },
        { identifier: 'PAN-4', canonicalStatus: 'in_review' },
        { identifier: 'PAN-5', canonicalStatus: 'verifying_on_main' },
        { identifier: 'PAN-6', canonicalStatus: 'done' },
        { identifier: 'PAN-7', canonicalStatus: 'canceled' },
      ]).map((i) => [i.ref, i.state]),
    );
    expect(byRef).toEqual({
      'PAN-1': 'open',
      'PAN-2': 'open',
      'PAN-3': 'in_progress',
      'PAN-4': 'in_review',
      'PAN-5': 'in_progress',
      'PAN-6': 'closed',
      'PAN-7': 'closed',
    });
  });

  it('falls back to `state` then `status` when canonicalStatus is absent', () => {
    const [a, b] = normalizeBacklogIssues([
      { identifier: 'PAN-8', state: 'in_progress' },
      { identifier: 'PAN-9', status: 'In Review' },
    ]);
    expect(a!.state).toBe('in_progress');
    expect(b!.state).toBe('in_review');
  });

  it('carries body, labels, priority and timestamps used by ranking', () => {
    const [issue] = normalizeBacklogIssues([
      {
        identifier: 'PAN-10',
        title: 'Title',
        description: 'Body text',
        labels: ['bug', 'p1'],
        priority: 2,
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
        source: 'github',
      },
    ]);
    expect(issue).toMatchObject({
      ref: 'PAN-10',
      title: 'Title',
      description: 'Body text',
      labels: ['bug', 'p1'],
      priority: 2,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-02T00:00:00Z',
      tracker: 'github',
    });
  });

  it('drops issues with no usable human ref (cannot be ranked)', () => {
    const out = normalizeBacklogIssues([
      { title: 'no ref here', canonicalStatus: 'todo' },
      { identifier: '', canonicalStatus: 'todo' },
      { identifier: 'PAN-11', canonicalStatus: 'todo' },
    ]);
    expect(out.map((i) => i.ref)).toEqual(['PAN-11']);
  });
});
