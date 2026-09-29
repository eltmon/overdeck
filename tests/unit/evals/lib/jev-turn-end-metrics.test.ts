import { describe, expect, it } from 'vitest';
import {
  findFixtureLeaks,
  perClassMetrics,
  type TurnEndFixture,
} from '../../../../evals/lib/jev-turn-end-metrics.js';
import { TURN_END_KINDS } from '../../../../src/lib/jev/questions.js';
import fixtures from '../../../../evals/fixtures/jev-turn-end.json' with { type: 'json' };

describe('perClassMetrics', () => {
  it('computes precision/recall/support on a hand-made 6-row set', () => {
    const rows = [
      { label: 'asks_operator' as const, predicted: 'asks_operator' as const },
      { label: 'asks_operator' as const, predicted: null },
      { label: 'reports_complete' as const, predicted: 'reports_complete' as const },
      { label: 'reports_complete' as const, predicted: 'reports_blocked' as const },
      { label: 'reports_blocked' as const, predicted: 'reports_blocked' as const },
      { label: 'progress_update' as const, predicted: null },
    ];

    expect(perClassMetrics(rows)).toEqual({
      asks_operator: { precision: 1, recall: 0.5, support: 2 },
      reports_complete: { precision: 1, recall: 0.5, support: 2 },
      reports_blocked: { precision: 0.5, recall: 1, support: 1 },
      progress_update: { precision: null, recall: 0, support: 1 },
      other: { precision: null, recall: null, support: 0 },
    });
  });
});

describe('findFixtureLeaks', () => {
  function fixture(text: string, overrides: Partial<TurnEndFixture> = {}): TurnEndFixture {
    return { name: 'leak-case', role: 'work', text, label: 'other', ...overrides };
  }

  it('flags a string containing /home/alice/x', () => {
    expect(findFixtureLeaks([fixture('cd /home/alice/x && run the build')])).toEqual(['leak-case: home-path']);
  });

  it('flags a string containing MIN-12', () => {
    expect(findFixtureLeaks([fixture('Fixed MIN-12 today, tests pass.')])).toEqual(['leak-case: private-issue-prefix']);
  });

  it('flags a token-shaped string built at runtime, never a literal one', () => {
    const token = 'xo' + 'xb-' + '123456789012-123456789012-abcdefghijklmnopqrstuvwx';
    expect(findFixtureLeaks([fixture(`posted with token ${token}`)])).toEqual(['leak-case: slack-token']);
  });

  it('flags an email address', () => {
    expect(findFixtureLeaks([fixture('reach out to a' + 'lice@example.com for access')])).toEqual(['leak-case: email']);
  });

  it('returns no leaks for clean, already-sanitized text', () => {
    expect(findFixtureLeaks([fixture('Fixed PAN-12 today, ran the tests under <path>.')])).toEqual([]);
  });
});

describe('the committed jev-turn-end fixture (PAN-4371)', () => {
  const rows = fixtures as ReadonlyArray<TurnEndFixture>;
  const REQUIRED_CLASSES = ['asks_operator', 'reports_complete', 'reports_blocked', 'progress_update'] as const;

  it('has at least 40 rows', () => {
    expect(rows.length).toBeGreaterThanOrEqual(40);
  });

  it('has at least 8 rows for each required class', () => {
    for (const kind of REQUIRED_CLASSES) {
      const count = rows.filter((r) => r.label === kind).length;
      expect(count, `${kind} has ${count} rows, need >= 8`).toBeGreaterThanOrEqual(8);
    }
  });

  it('uses only valid labels', () => {
    for (const row of rows) {
      expect(TURN_END_KINDS as readonly string[]).toContain(row.label);
    }
  });

  it('has no leaks', () => {
    expect(findFixtureLeaks(rows)).toEqual([]);
  });
});
