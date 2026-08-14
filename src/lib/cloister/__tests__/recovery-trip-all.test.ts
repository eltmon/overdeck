import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const projects = vi.hoisted(() => ({
  registry: new Map<string, { projectKey: string; projectPath: string }>(),
}));
vi.mock('../../projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../projects.js')>();
  return {
    ...actual,
    resolveProjectFromIssueSync: vi.fn((issueId: string) => projects.registry.get(issueId.toUpperCase()) ?? null),
    getProjectSync: vi.fn((key: string) => {
      for (const value of projects.registry.values()) {
        if (value.projectKey === key) return { name: key, path: value.projectPath };
      }
      return null;
    }),
  };
});

import { acknowledgeAllOpenRecoveryTrips, recordRecoveryFailure } from '../recovery-trip.js';
import { readIssueRecord } from '../../pan-dir/record.js';
import { cleanupGitRecordRoot, initGitRecordRoot, removeGitRecordRemote } from '../../../../tests/helpers/git-record-fixture.js';

let workspace = '';
let remote: string | null = null;
afterEach(async () => {
  removeGitRecordRemote(remote);
  remote = null;
  if (workspace) await cleanupGitRecordRoot(workspace);
  projects.registry.clear();
});

describe('acknowledgeAllOpenRecoveryTrips', () => {
  it('acks only the open trips and leaves the closed trip in place', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-3727-ack-all-'));
    remote = initGitRecordRoot(workspace);
    projects.registry.set('PAN-9001', { projectKey: 'fixture-project', projectPath: workspace });

    // Two trips that open on their first failure (threshold=1).
    await recordRecoveryFailure(workspace, 'PAN-9001', 'trip-a', 'wi-1', 1);
    await recordRecoveryFailure(workspace, 'PAN-9001', 'trip-b', 'wi-2', 1);
    // One trip that stays closed (threshold never reached).
    await recordRecoveryFailure(workspace, 'PAN-9001', 'trip-c', 'wi-3', 100);

    const acked = await acknowledgeAllOpenRecoveryTrips('PAN-9001');
    expect(acked).toBe(2);

    const project = { name: 'fixture-project', path: workspace };
    const record = await readIssueRecord(project, 'PAN-9001');
    const remaining = record?.recoveryTrips ?? [];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.recoveryPath).toBe('trip-c');
    expect(remaining[0]?.open).toBe(false);
  });

  it('returns 0 and writes nothing for an issue that resolves to no project', async () => {
    const acked = await acknowledgeAllOpenRecoveryTrips('MIN-9999');
    expect(acked).toBe(0);
  });
});
