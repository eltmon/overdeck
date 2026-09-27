import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reportsDir } from '../ids.js';
import {
  MAX_WORKER_REPORT_BYTES,
  latestWorkerReport,
  latestWorkerReportAt,
  listWorkerReports,
  writeWorkerReport,
} from '../report.js';

const ID = 'agent-pan-9-worker-1';
let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.OVERDECK_HOME;
  home = mkdtempSync(join(tmpdir(), 'worker-report-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('worker reports (PAN-3920 D15)', () => {
  it('numbers reports 1 and 2 and leaves no temp file', async () => {
    expect(await writeWorkerReport(ID, { body: '# first' })).toBe(1);
    expect(await writeWorkerReport(ID, { body: '# second', status: 'blocked' })).toBe(2);

    expect(readdirSync(reportsDir(ID)).sort()).toEqual(['0001.json', '0002.json']);
    const reports = await listWorkerReports(ID);
    expect(reports.map((report) => [report.seq, report.status, report.body])).toEqual([
      [1, 'done', '# first'],
      [2, 'blocked', '# second'],
    ]);
    expect((await latestWorkerReport(ID))?.seq).toBe(2);
    expect(await latestWorkerReportAt(ID)).toEqual(expect.any(Number));
  });

  it('gives concurrent writers distinct sequence numbers', async () => {
    const seqs = await Promise.all([1, 2, 3].map((n) => writeWorkerReport(ID, { body: `r${n}` })));
    expect([...seqs].sort()).toEqual([1, 2, 3]);
  });

  it('rejects a body over 1 MiB', async () => {
    await expect(writeWorkerReport(ID, { body: 'x'.repeat(2 * MAX_WORKER_REPORT_BYTES) })).rejects.toThrow('larger than');
    expect(await listWorkerReports(ID)).toEqual([]);
  });

  it('round-trips the git facts a lane records (PAN-4223)', async () => {
    await writeWorkerReport(ID, { body: '# lane', git: { head: 'abc1234', branch: 'hotel/663' } });
    await writeWorkerReport(ID, { body: '# critic', git: { head: 'def5678', branch: null } });
    const reports = await listWorkerReports(ID);
    expect(reports.map((report) => report.git)).toEqual([
      { head: 'abc1234', branch: 'hotel/663' },
      { head: 'def5678', branch: null },
    ]);
  });

  it('parses a stored report without git and drops a malformed git field', async () => {
    mkdirSync(reportsDir(ID), { recursive: true });
    const base = { at: '2026-09-23T12:00:00.000Z', status: 'done', body: 'old' };
    writeFileSync(join(reportsDir(ID), '0001.json'), JSON.stringify({ seq: 1, ...base }));
    writeFileSync(join(reportsDir(ID), '0002.json'), JSON.stringify({ seq: 2, ...base, git: { head: 7 } }));
    const reports = await listWorkerReports(ID);
    expect(reports).toHaveLength(2);
    expect(reports.map((report) => 'git' in report)).toEqual([false, false]);
  });

  it('round-trips a critic verdict and drops a malformed one (PAN-4223 WI-16)', async () => {
    await writeWorkerReport(ID, { body: '# verdict', verdict: { value: 'NOT_YET', defects: 3, file: '/x/v.json' } });
    expect((await listWorkerReports(ID))[0]?.verdict).toEqual({ value: 'NOT_YET', defects: 3, file: '/x/v.json' });

    const base = { at: '2026-09-23T12:00:00.000Z', status: 'done', body: 'old' };
    writeFileSync(join(reportsDir(ID), '0002.json'), JSON.stringify({ seq: 2, ...base }));
    writeFileSync(join(reportsDir(ID), '0003.json'), JSON.stringify({ seq: 3, ...base, verdict: { value: 'MAYBE', defects: null, file: null } }));
    writeFileSync(join(reportsDir(ID), '0004.json'), JSON.stringify({ seq: 4, ...base, verdict: { value: 'PASS', defects: -1, file: null } }));
    const reports = await listWorkerReports(ID);
    expect(reports.map((report) => [report.seq, report.body, report.verdict])).toEqual([
      [1, '# verdict', { value: 'NOT_YET', defects: 3, file: '/x/v.json' }],
      [2, 'old', undefined],
      [3, 'old', undefined],
      [4, 'old', undefined],
    ]);
  });

  it('has no latest report for a worker that never reported', async () => {
    expect(await latestWorkerReport(ID)).toBeNull();
    expect(await latestWorkerReportAt(ID)).toBeNull();
  });
});
