import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { appendJevUsage, readJevUsageSummary, resolveJevUsageLogPath, type JevUsageRow } from '../usage-log.js';

const NOW = new Date('2026-10-04T12:00:00Z');
const FEATURE = 'jevTurnEndAssessment';

function isoHoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function row(overrides: Partial<JevUsageRow> = {}): JevUsageRow {
  return {
    ts: isoHoursAgo(1),
    feature: FEATURE,
    outcome: 'answered',
    model: 'jev-1.13-free',
    durationMs: 120,
    ...overrides,
  };
}

const tmpDirs: string[] = [];
async function tmpHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jev-usage-log-'));
  tmpDirs.push(dir);
  return dir;
}

async function seedLine(home: string, data: JevUsageRow | string, date = typeof data === 'string' ? NOW : new Date(data.ts)): Promise<void> {
  const filePath = resolveJevUsageLogPath(home, date);
  await mkdir(dirname(filePath), { recursive: true });
  const line = typeof data === 'string' ? data : JSON.stringify(data);
  await writeFile(filePath, `${line}\n`, { flag: 'a' });
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('appendJevUsage / resolveJevUsageLogPath (PAN-4508)', () => {
  it('writes one line to <home>/jev/usage/<UTC day>.jsonl keyed off the row timestamp', async () => {
    const home = await tmpHome();
    await appendJevUsage(row({ ts: '2026-10-04T12:00:00.000Z' }), { home });

    const text = await readFile(resolveJevUsageLogPath(home, new Date('2026-10-04T12:00:00.000Z')), 'utf8');
    expect(JSON.parse(text.trim())).toEqual(row({ ts: '2026-10-04T12:00:00.000Z' }));
  });

  it('swallows a write failure (path collides with a regular file)', async () => {
    const home = await tmpHome();
    const usageDir = join(home, 'jev', 'usage');
    await mkdir(dirname(usageDir), { recursive: true });
    await writeFile(usageDir, 'not a directory');

    await expect(appendJevUsage(row(), { home })).resolves.toBeUndefined();
  });
});

describe('readJevUsageSummary (PAN-4508)', () => {
  it('counts calls within 24h and reports lastCallAt as the newest row regardless of window', async () => {
    const home = await tmpHome();
    await seedLine(home, row({ ts: isoHoursAgo(1) }));
    await seedLine(home, row({ ts: isoHoursAgo(23) }));
    await seedLine(home, row({ ts: isoHoursAgo(25) }));

    const summary = await readJevUsageSummary({ home, now: () => NOW });

    expect(summary.hours).toBe(24);
    expect(summary.features[FEATURE].calls24h).toBe(2);
    expect(summary.features[FEATURE].lastCallAt).toBe(isoHoursAgo(1));
  });

  it('reports lastCallAt from an old row even when calls24h is zero', async () => {
    const home = await tmpHome();
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await seedLine(home, row({ ts: threeDaysAgo }));

    const summary = await readJevUsageSummary({ home, now: () => NOW });

    expect(summary.features[FEATURE].calls24h).toBe(0);
    expect(summary.features[FEATURE].lastCallAt).toBe(threeDaysAgo);
  });

  it('returns lastError from the newest failed row, zeros/nulls for a missing usage directory, and skips an unparsable line', async () => {
    const home = await tmpHome();
    await seedLine(home, row({ ts: isoHoursAgo(5), outcome: 'failed', reason: 'rate-limited', status: 429 }));
    await seedLine(home, row({ ts: isoHoursAgo(2), outcome: 'failed', reason: 'auth-failed', status: 401 }));
    await seedLine(home, 'not json');

    const summary = await readJevUsageSummary({ home, now: () => NOW });

    expect(summary.features[FEATURE].lastError).toEqual({ at: isoHoursAgo(2), reason: 'auth-failed', status: 401 });

    const emptyHome = await tmpHome();
    const emptySummary = await readJevUsageSummary({ home: emptyHome, now: () => NOW });
    for (const feature of ['jevTurnEndAssessment', 'jevAcceptanceCriteriaReview', 'jevMemoryRelevance'] as const) {
      expect(emptySummary.features[feature]).toEqual({ calls24h: 0, lastCallAt: null, lastError: null });
    }
  });
});
