/** PAN-4264 Work Item 18: `pan doctor github-quota --json` reports per-caller totals from the ledger. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { doctorGithubQuotaCommand } from '../../../src/cli/commands/doctor-github-quota.js';
import { appendLedgerEntry, type LedgerEntryInput } from '../../../src/lib/github-quota/ledger.js';
import { recordGitHubRefusal } from '../../../src/lib/github-quota/pause-gate.js';

function call(overrides: Partial<LedgerEntryInput>): LedgerEntryInput {
  return { kind: 'call', caller: 'pipeline-membership', pool: 'user', bucket: 'graphql', cost: 1, estimated: false, outcome: 'ok', ...overrides };
}

describe('pan doctor github-quota (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-doctor-quota-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('prints per-caller totals, samples and the active pause as JSON', async () => {
    await appendLedgerEntry(call({ cost: 40 }));
    await appendLedgerEntry(call({ cost: 2 }));
    await appendLedgerEntry(call({ caller: 'ci-repair', bucket: 'rest', estimated: true }));
    await appendLedgerEntry(call({ kind: 'sample', caller: 'quota-sampler', cost: 0, remaining: 4900, limit: 5000 }));
    await recordGitHubRefusal({ pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'secondary' } });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await doctorGithubQuotaCommand({ json: true });
    const report = JSON.parse(String(log.mock.calls[0]![0]));

    expect(report.callers).toEqual([
      { caller: 'pipeline-membership', graphql: { points: 42, calls: 2 }, rest: { points: 0, calls: 0 }, estimated: false },
      { caller: 'ci-repair', graphql: { points: 0, calls: 0 }, rest: { points: 1, calls: 1 }, estimated: true },
      { caller: 'pr-sync', graphql: { points: 1, calls: 1 }, rest: { points: 0, calls: 0 }, estimated: true },
    ]);
    expect(report.samples).toEqual([expect.objectContaining({ pool: 'user', bucket: 'graphql', remaining: 4900, limit: 5000 })]);
    expect(report.pause).toEqual([expect.objectContaining({ pool: 'user', bucket: 'graphql', kind: 'secondary' })]);
    expect(report.skippedProjects).toEqual([]);
    expect(report.appMissingRepos).toEqual([]);
    // Operator grouping is off by default: the remote view says why it is unavailable.
    expect(report.otherInstalls).toMatchObject({ available: false, installs: [] });
    expect(report.otherInstalls.reason).toContain('operator_grouping');
  });

  it('prints the human sections without a ledger', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await doctorGithubQuotaCommand();
    const text = log.mock.calls.map(([line]) => String(line)).join('\n');
    for (const heading of ['Callers, last hour', 'Latest samples', 'Active pause', 'Projects skipped for tracker config', 'Repos where the GitHub App is not installed', 'Other installs for this operator']) {
      expect(text).toContain(heading);
    }
  });
});
