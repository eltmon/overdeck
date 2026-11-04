import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-cost-issue-rollup-bench-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../src/lib/overdeck/infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

// 750k rows written through the rollup triggers, in one transaction.
const SEED_SQL = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 750000)
INSERT INTO cost_events (ts, issue_id, agent_id, session_type, provider, model,
  input, output, cache_read, cache_write, cost, request_id)
SELECT 1700000000000 + i,
       CASE WHEN i % 7 = 0 THEN NULL ELSE 'PAN-' || (i % 900) END,
       'agent-' || (i % 50),
       CASE i % 3 WHEN 0 THEN 'work' WHEN 1 THEN 'review' ELSE 'planning' END,
       CASE WHEN i % 500 = 0 THEN NULL ELSE 'anthropic' END,
       'model-' || (i % 4), 100, 50, 1000, 10, 0.001, 'bench-' || i
FROM n`;

describe('cost issue rollup bench (PAN-4724)', () => {
  it('serves the per-issue cost snapshot under 50 ms against 750,000 cost rows', async () => {
    const { getOverdeckDatabase } = await import('../../src/lib/overdeck/infra.js');
    const { getCostsByIssueSnapshot } = await import('../../src/dashboard/server/services/dashboard-cost-snapshot.js');
    const { formatSlowJobLine } = await import('../../src/dashboard/server/services/dashboard-db-task.js');

    const db = getOverdeckDatabase();
    db.exec('BEGIN');
    db.exec(SEED_SQL);
    db.exec('COMMIT');

    const warm = getCostsByIssueSnapshot();
    const timings: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      getCostsByIssueSnapshot();
      timings.push(performance.now() - started);
    }
    const median = [...timings].sort((a, b) => a - b)[2]!;

    expect(median).toBeLessThan(50);
    expect(formatSlowJobLine({
      op: 'getCostsByIssueSnapshot', lane: 'poll', waitMs: 0, runMs: Math.round(median), depth: 0,
    })).toBeNull();
    // 7 and 900 are coprime, so every PAN-0…PAN-899 key occurs, plus the NULL bucket.
    expect(warm.issues).toHaveLength(901);
    expect(warm.issues.some((issue) => issue.issueId === 'null')).toBe(true);
  }, 60_000);
});
