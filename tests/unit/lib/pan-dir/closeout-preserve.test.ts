import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecordSync,
  writeIssueRecordSync,
  type PanIssueRecord,
} from '../../../../src/lib/pan-dir/record.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function baseRecord(issueId: string, closeOut: PanIssueRecord['closeOut']): PanIssueRecord {
  const now = new Date().toISOString();
  return {
    issueId,
    schemaVersion: 2,
    created: now,
    updated: now,
    pipeline: { issueId, reviewStatus: 'passed', testStatus: 'passed', readyForMerge: false, updatedAt: now },
    closeOut,
  } as PanIssueRecord;
}

const POPULATED: PanIssueRecord['closeOut'] = {
  usage: {
    byStage: { 'memory-extraction': { 'anthropic/claude-haiku-4-5': { input: 1200, output: 340 } } },
    totals: { input: 1200, output: 340 },
  },
  merges: [{ repo: 'overdeck', sha: 'abc1234' }],
  ranOn: 'test-host',
} as PanIssueRecord['closeOut'];

const EMPTY: PanIssueRecord['closeOut'] = {
  usage: { byStage: {}, totals: {} },
  merges: [],
  ranOn: 'test-host',
} as PanIssueRecord['closeOut'];

describe('closeOut no-loss guard (PAN-2466)', () => {
  it('a write carrying an empty closeOut preserves the populated on-disk closeOut', () => {
    const ws = mkdtempSync(join(tmpdir(), 'pan-closeout-'));
    dirs.push(ws);
    const project = getProjectConfigFromWorkspacePath(ws);
    writeIssueRecordSync(project, 'PAN-2466', baseRecord('PAN-2466', POPULATED));

    // Simulate the clobber: a caller that missed the read falls back to the
    // fresh template (empty closeOut) and writes it.
    writeIssueRecordSync(project, 'PAN-2466', baseRecord('PAN-2466', EMPTY));

    const after = readIssueRecordSync(project, 'PAN-2466');
    expect(after?.closeOut?.usage?.byStage?.['memory-extraction']).toBeDefined();
    expect(after?.closeOut?.merges).toHaveLength(1);
  });

  it('a genuine closeOut update still wins over the on-disk version', () => {
    const ws = mkdtempSync(join(tmpdir(), 'pan-closeout-'));
    dirs.push(ws);
    const project = getProjectConfigFromWorkspacePath(ws);
    writeIssueRecordSync(project, 'PAN-2466', baseRecord('PAN-2466', POPULATED));

    const updated = structuredClone(POPULATED)!;
    (updated.usage.totals as Record<string, number>).input = 9999;
    writeIssueRecordSync(project, 'PAN-2466', baseRecord('PAN-2466', updated));

    const after = readIssueRecordSync(project, 'PAN-2466');
    expect(after?.closeOut?.usage?.totals?.input).toBe(9999);
  });

  it('an empty later write preserves a populated Definition-of-Done gate', () => {
    const ws = mkdtempSync(join(tmpdir(), 'pan-closeout-'));
    dirs.push(ws);
    const project = getProjectConfigFromWorkspacePath(ws);
    const withGate = structuredClone(EMPTY)!;
    withGate.dodGate = {
      evaluatedAt: '2026-07-15T13:00:00Z',
      accepted: ['deploy'],
      rows: [{
        id: 'deploy', num: 7, title: 'Deployed', expected: 'live build includes merge',
        observed: 'accepted stale build', status: 'miss',
        acceptedBy: { flag: '--accept-deploy', by: 'operator', at: '2026-07-15T13:00:00Z' },
      }],
    };
    writeIssueRecordSync(project, 'PAN-2466', baseRecord('PAN-2466', withGate));
    writeIssueRecordSync(project, 'PAN-2466', baseRecord('PAN-2466', EMPTY));

    expect(readIssueRecordSync(project, 'PAN-2466')?.closeOut.dodGate).toEqual(withGate.dodGate);
  });

  it('first write of a fresh record with empty closeOut is untouched', () => {
    const ws = mkdtempSync(join(tmpdir(), 'pan-closeout-'));
    dirs.push(ws);
    const project = getProjectConfigFromWorkspacePath(ws);
    writeIssueRecordSync(project, 'PAN-2466', baseRecord('PAN-2466', EMPTY));
    const after = readIssueRecordSync(project, 'PAN-2466');
    expect(Object.keys(after?.closeOut?.usage?.byStage ?? { x: 1 })).toHaveLength(0);
  });
});
