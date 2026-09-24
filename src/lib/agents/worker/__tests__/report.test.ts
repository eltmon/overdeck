import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
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

  it('has no latest report for a worker that never reported', async () => {
    expect(await latestWorkerReport(ID)).toBeNull();
    expect(await latestWorkerReportAt(ID)).toBeNull();
  });
});
