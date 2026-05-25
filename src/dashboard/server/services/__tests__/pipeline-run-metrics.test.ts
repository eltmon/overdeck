import { describe, expect, it } from 'vitest';
import type { DbAdapter, StoredEvent } from '../../event-store.js';
import { createPipelineRunMetricsReader, createPipelineRunStatsInputsReader, derivePipelineRunMetricsFromEvents, derivePipelineRunStatsInputsFromEvents } from '../pipeline-run-metrics.js';

function event(sequence: number, type: string, timestamp: string, payload: Record<string, unknown>): StoredEvent {
  return { sequence, type, timestamp, payload };
}

function rowFrom(event: StoredEvent): Record<string, unknown> {
  return {
    sequence: event.sequence,
    type: event.type,
    timestamp: event.timestamp,
    payload: JSON.stringify(event.payload),
  };
}

function createReader(events: StoredEvent[]) {
  let sql = '';
  let params: unknown[] = [];
  const db: DbAdapter = {
    prepare<R>(statement: string) {
      sql = statement;
      return {
        all(input?: unknown[]): R[] {
          params = input ?? [];
          const issueId = params.at(-1);
          return events
            .filter((stored) => (stored.payload as Record<string, unknown>)['issueId'] === issueId)
            .map(rowFrom) as R[];
        },
        get(): R | undefined {
          return undefined;
        },
        run() {
          return { changes: 0 };
        },
      };
    },
    exec() {},
  };

  return {
    reader: createPipelineRunMetricsReader(db),
    getSql: () => sql,
    getParams: () => params,
  };
}

describe('pipeline run metrics', () => {
  it('derives stage durations for a happy-path single-pass issue', () => {
    const metrics = derivePipelineRunMetricsFromEvents([
      event(1, 'agent.created', '2026-05-25T10:00:00.000Z', { issueId: 'PAN-1', agent: { role: 'plan' } }),
      event(2, 'agent.completed', '2026-05-25T10:00:10.000Z', { issueId: 'PAN-1', role: 'plan' }),
      event(3, 'agent.created', '2026-05-25T10:00:20.000Z', { issueId: 'PAN-1', agent: { role: 'work' } }),
      event(4, 'pipeline.review-started', '2026-05-25T10:00:40.000Z', { issueId: 'PAN-1' }),
      event(5, 'pipeline.review-completed', '2026-05-25T10:00:50.000Z', { issueId: 'PAN-1', passed: true, headSha: 'abc123' }),
      event(6, 'pipeline.test-started', '2026-05-25T10:01:00.000Z', { issueId: 'PAN-1' }),
      event(7, 'pipeline.test-completed', '2026-05-25T10:01:15.000Z', { issueId: 'PAN-1', passed: true }),
      event(8, 'issue.statusChanged', '2026-05-25T10:01:35.000Z', { issueId: 'PAN-1', canonicalStatus: 'verifying_on_main' }),
    ], 'PAN-1');

    expect(metrics).toEqual({
      plan: 10_000,
      work: 20_000,
      review: 10_000,
      test: 15_000,
      ship: 20_000,
      mergeMs: 95_000,
      outcome: 'merged',
      interventionCount: 0,
      passCount: 0,
      headSha: 'abc123',
    });
  });

  it('sums multi-cycle review and test durations', () => {
    const metrics = derivePipelineRunMetricsFromEvents([
      event(1, 'pipeline.review-started', '2026-05-25T10:00:00.000Z', { issueId: 'PAN-2' }),
      event(2, 'pipeline.review-completed', '2026-05-25T10:00:10.000Z', { issueId: 'PAN-2', passed: false }),
      event(3, 'pipeline.review-started', '2026-05-25T10:00:20.000Z', { issueId: 'PAN-2' }),
      event(4, 'pipeline.review-completed', '2026-05-25T10:00:35.000Z', { issueId: 'PAN-2', passed: true }),
      event(5, 'pipeline.test-started', '2026-05-25T10:00:40.000Z', { issueId: 'PAN-2' }),
      event(6, 'pipeline.test-completed', '2026-05-25T10:00:55.000Z', { issueId: 'PAN-2', passed: false }),
      event(7, 'pipeline.test-started', '2026-05-25T10:01:00.000Z', { issueId: 'PAN-2' }),
      event(8, 'pipeline.test-completed', '2026-05-25T10:01:20.000Z', { issueId: 'PAN-2', passed: true }),
    ], 'PAN-2');

    expect(metrics.review).toBe(25_000);
    expect(metrics.test).toBe(35_000);
    expect(metrics.passCount).toBe(2);
  });

  it('counts operator interventions scoped to the issue id', () => {
    const metrics = derivePipelineRunMetricsFromEvents([
      event(1, 'operator.intervention', '2026-05-25T10:00:00.000Z', { issueId: 'PAN-3', kind: 'tell' }),
      event(2, 'operator.intervention', '2026-05-25T10:00:01.000Z', { issueId: 'PAN-4', kind: 'tell' }),
      event(3, 'operator.intervention', '2026-05-25T10:00:02.000Z', { issueId: 'PAN-3', kind: 'pause' }),
    ], 'PAN-3');

    expect(metrics.interventionCount).toBe(2);
  });

  it.each([
    ['parked', 'parked'],
    ['cancelled', 'cancelled'],
    ['canceled', 'cancelled'],
  ] as const)('resolves %s terminal status outcome', (status, outcome) => {
    const metrics = derivePipelineRunMetricsFromEvents([
      event(1, 'issue.status_changed', '2026-05-25T10:00:00.000Z', { issueId: 'PAN-5', status }),
    ], 'PAN-5');

    expect(metrics.outcome).toBe(outcome);
  });

  it('returns in_flight for issues without a terminal event', () => {
    const metrics = derivePipelineRunMetricsFromEvents([
      event(1, 'pipeline.review-started', '2026-05-25T10:00:00.000Z', { issueId: 'PAN-6' }),
    ], 'PAN-6');

    expect(metrics.outcome).toBe('in_flight');
    expect(metrics.mergeMs).toBeNull();
    expect(metrics.ship).toBeNull();
  });

  it('derives stats inputs from completed runs and verification attempts in a window', () => {
    const inputs = derivePipelineRunStatsInputsFromEvents([
      event(1, 'plan.item_status_changed', '2026-05-25T09:00:00.000Z', { issueId: 'PAN-8', itemId: 'D1', status: 'done' }),
      event(2, 'pipeline.review-started', '2026-05-25T09:01:00.000Z', { issueId: 'PAN-8' }),
      event(3, 'pipeline.review-completed', '2026-05-25T09:02:00.000Z', { issueId: 'PAN-8', passed: false, substrateAttributable: true, headSha: 'abc123' }),
      event(4, 'pipeline.test-started', '2026-05-25T09:03:00.000Z', { issueId: 'PAN-8' }),
      event(5, 'pipeline.test-completed', '2026-05-25T09:04:00.000Z', { issueId: 'PAN-8', passed: true, headSha: 'abc123' }),
      event(6, 'operator.intervention', '2026-05-25T09:05:00.000Z', { issueId: 'PAN-8', kind: 'tell' }),
      event(7, 'issue.statusChanged', '2026-05-25T09:06:00.000Z', { issueId: 'PAN-8', canonicalStatus: 'verifying_on_main' }),
      event(8, 'issue.statusChanged', '2026-04-01T09:06:00.000Z', { issueId: 'PAN-9', canonicalStatus: 'verifying_on_main' }),
    ], '2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z');

    expect(inputs.completedPipelineRuns).toBe(1);
    expect(inputs.pipelineRuns).toMatchObject([{ issueId: 'PAN-8', planItemsCount: 1, metrics: { interventionCount: 1, outcome: 'merged' } }]);
    expect(inputs.verificationAttempts).toEqual([
      { issueId: 'PAN-8', stage: 'review', passed: false, headSha: 'abc123', substrateAttributable: true },
      { issueId: 'PAN-8', stage: 'test', passed: true, headSha: 'abc123' },
    ]);
  });

  it('queries the events table with parameterized issue id binding', () => {
    const { reader, getSql, getParams } = createReader([
      event(1, 'operator.intervention', '2026-05-25T10:00:00.000Z', { issueId: 'PAN-7', kind: 'tell' }),
    ]);

    const metrics = reader.derivePipelineRunMetrics('PAN-7');

    expect(metrics.interventionCount).toBe(1);
    expect(getSql()).toContain("json_extract(payload, '$.issueId') = ?");
    expect(getSql()).not.toContain('PAN-7');
    expect(getParams().at(-1)).toBe('PAN-7');
  });

  it('derives stats with windowed terminal lookup and one relevant-issue history scan', () => {
    const statements: string[] = [];
    const calls: unknown[][] = [];
    const completedIssueIds = [{ issueId: 'PAN-10' }];
    const verificationRows = [
      rowFrom(event(4, 'pipeline.review-completed', '2026-05-25T09:02:00.000Z', { issueId: 'PAN-10', passed: true, headSha: 'sha' })),
    ];
    const issueHistoryRows = [
      rowFrom(event(1, 'agent.created', '2026-04-30T09:00:00.000Z', { issueId: 'PAN-10', agent: { role: 'plan' } })),
      rowFrom(event(2, 'agent.completed', '2026-04-30T09:01:00.000Z', { issueId: 'PAN-10', role: 'plan' })),
      rowFrom(event(3, 'pipeline.review-started', '2026-05-25T09:01:00.000Z', { issueId: 'PAN-10' })),
      rowFrom(event(4, 'pipeline.review-completed', '2026-05-25T09:02:00.000Z', { issueId: 'PAN-10', passed: true, headSha: 'sha' })),
      rowFrom(event(5, 'issue.statusChanged', '2026-05-25T09:03:00.000Z', { issueId: 'PAN-10', canonicalStatus: 'verifying_on_main' })),
    ];
    const db: DbAdapter = {
      prepare<R>(statement: string) {
        statements.push(statement);
        return {
          all(input?: unknown[]): R[] {
            calls.push(input ?? []);
            if (statement.includes('SELECT DISTINCT json_extract')) return completedIssueIds as R[];
            if (statement.includes("type IN (?, ?)") && statement.includes('pipeline.review-completed')) return verificationRows as R[];
            return issueHistoryRows as R[];
          },
          get(): R | undefined {
            return undefined;
          },
          run() {
            return { changes: 0 };
          },
        };
      },
      exec() {},
    };

    const inputs = createPipelineRunStatsInputsReader(db).derivePipelineRunStatsInputs(
      '2026-05-01T00:00:00.000Z',
      '2026-05-31T00:00:00.000Z',
    );

    expect(inputs.completedPipelineRuns).toBe(1);
    expect(inputs.pipelineRuns[0]).toMatchObject({ issueId: 'PAN-10', metrics: { plan: 60_000, outcome: 'merged' } });
    expect(inputs.verificationAttempts).toEqual([{ issueId: 'PAN-10', stage: 'review', passed: true, headSha: 'sha' }]);
    expect(statements[0]).toContain('timestamp >= ?');
    expect(statements[0]).toContain('timestamp <= ?');
    expect(statements[2]).toContain("json_extract(payload, '$.issueId') IN (?)");
    expect(statements[2]).toContain('timestamp <= ?');
    expect(statements[2]).not.toMatch(/FROM events\s+WHERE type IN \([^)]*\)\s+AND timestamp <= \?\s+ORDER BY/s);
    expect(calls[0].slice(-2)).toEqual(['2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z']);
    expect(calls[2].at(-1)).toBe('PAN-10');
  });
});
