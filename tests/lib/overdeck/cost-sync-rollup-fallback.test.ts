import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCostsByIssue, getCostsByIssueFullScan, insertCostEvent } from '../../../src/lib/overdeck/cost-sync.js';
import { closeOverdeckDatabase } from '../../../src/lib/overdeck/infra.js';

// A module-wide mock: infra.ts then also skips the install, which is the state under test.
vi.mock('../../../src/lib/overdeck/cost-issue-rollup.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/overdeck/cost-issue-rollup.js')>()),
  ensureCostIssueRollup: vi.fn(() => false),
}));

let originalOverdeckHome: string | undefined;
let testHome: string;

beforeEach(() => {
  originalOverdeckHome = process.env.OVERDECK_HOME;
  testHome = join(tmpdir(), `pan-4724-rollup-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(() => {
  vi.restoreAllMocks();
  closeOverdeckDatabase();
  if (originalOverdeckHome === undefined) {
    delete process.env.OVERDECK_HOME;
  } else {
    process.env.OVERDECK_HOME = originalOverdeckHome;
  }
  rmSync(testHome, { recursive: true, force: true });
});

describe('getCostsByIssue rollup fallback (PAN-4724)', () => {
  it('falls back to the full scan when the rollup cannot install', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    insertCostEvent({
      ts: '2026-06-25T12:00:00.000Z', input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.25,
      provider: 'openai', model: 'gpt-test', requestId: 'f1', issueId: 'pan-5', sessionType: 'work',
    });
    insertCostEvent({
      ts: '2026-06-25T12:01:00.000Z', input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.5,
      model: 'gpt-test', requestId: 'f2', sessionType: 'review',
    });

    const first = getCostsByIssue();
    expect(first).toEqual(getCostsByIssueFullScan());
    expect(Object.keys(first).sort()).toEqual(['PAN-5', 'null']);
    getCostsByIssue();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain('[cost-issue-rollup]');
  });
});
