/** PAN-4651 WI-12 (D-4651-5): stand-in files — remote.json and mirrored reports. */
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workerDir } from '../ids.js';
import { listWorkerReports } from '../report.js';
import { listRemoteStandIns, mirrorRemoteReport, readRemoteStandIn, type RemoteStandIn, remoteStandInPath, writeRemoteStandIn } from '../remote-standin.js';

const previousHome = process.env.OVERDECK_HOME;
let home: string;

const STAND_IN: RemoteStandIn = {
  v: 1, environmentId: 'env-desk', label: 'desk', remoteId: 'agent-pan-9-worker-3', parentId: 'agent-pan-9', issueId: 'PAN-9',
  createdAt: '2026-11-01T12:00:00.000Z', state: 'running', lastSeq: 0, lastSeenAt: null, lastAssistantMessage: null, idleAgeMs: null, unreachableSince: null,
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pan-4651-standin-'));
  process.env.OVERDECK_HOME = home;
  mkdirSync(workerDir('agent-pan-9-worker-1'), { recursive: true });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('remote stand-in (D-4651-5)', () => {
  it('writes remote.json with mode 0600 and reads it back', async () => {
    await writeRemoteStandIn('agent-pan-9-worker-1', STAND_IN);
    expect(statSync(remoteStandInPath('agent-pan-9-worker-1')).mode & 0o777).toBe(0o600);
    expect(await readRemoteStandIn('agent-pan-9-worker-1')).toEqual(STAND_IN);
    expect(await listRemoteStandIns()).toEqual([{ localId: 'agent-pan-9-worker-1', standIn: STAND_IN }]);
  });

  it('a local worker has no stand-in', async () => {
    expect(await readRemoteStandIn('agent-pan-9-worker-1')).toBeNull();
  });

  it('mirrors reports keeping the owner seq, readable by listWorkerReports, and never overwrites one', async () => {
    await mirrorRemoteReport('agent-pan-9-worker-1', { seq: 2, at: '2026-11-01T12:01:00.000Z', status: 'blocked', body: 'need a decision' });
    await mirrorRemoteReport('agent-pan-9-worker-1', { seq: 1, at: '2026-11-01T12:00:00.000Z', status: 'done', body: 'first' });
    await mirrorRemoteReport('agent-pan-9-worker-1', { seq: 1, at: '2026-11-01T12:00:00.000Z', status: 'done', body: 'changed' });
    const reports = await listWorkerReports('agent-pan-9-worker-1');
    expect(reports.map((report) => [report.seq, report.status, report.body])).toEqual([[1, 'done', 'first'], [2, 'blocked', 'need a decision']]);
  });
});
