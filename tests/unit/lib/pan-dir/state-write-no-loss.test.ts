import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecordSync,
  writeIssueRecordSync,
  type PanIssueRecord,
} from '../../../../src/lib/pan-dir/record.js';

const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;

describe('state-write no-loss audit (PAN-1921)', () => {
  it('round-trips every PanIssueRecord field through the approved record writer', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'pan-record-no-loss-'));
    try {
      const project = getProjectConfigFromWorkspacePath(workspacePath);
      const issueId = 'PAN-1921';
      const now = new Date().toISOString();
      const original: PanIssueRecord = {
        issueId,
        schemaVersion: 2,
        created: now,
        updated: now,
        branch: 'feature/pan-1921',
        harness: 'claude-code',
        model: 'claude-opus-4-7',
        decisions: [{ id: 'D1', summary: 'Use record writer', recordedAt: now }],
        hazards: [{ id: 'H1', summary: 'Guard must not false-positive', mitigation: 'Allowlist known writers' }],
        resumePoint: { description: 'Resume here', beadId: 'b1', filesToRead: ['a.ts'] },
        beadsMapping: { 'item-1': ['bead-1'] },
        statusOverrides: { 'item-1': 'completed', 'item-1.sub-1': 'completed' },
        sessionHistory: [{ timestamp: now, reason: 'end', note: 'Done', agentModel: 'claude-opus-4-7' }],
        feedback: [{ seq: 1, specialist: 'review-agent', outcome: 'approved', timestamp: now, markdownBody: 'LGTM' }],
        pipeline: {
          issueId,
          reviewStatus: 'pending',
          testStatus: 'pending',
          readyForMerge: false,
          updatedAt: now,
        },
        closeOut: {
          usage: { byStage: {}, totals: {} },
          merges: ['abc123'],
          ranOn: 'localhost',
          closedAt: now,
        },
        owner: 'pan://localhost:3011',
      };

      writeIssueRecordSync(project, issueId, original);
      const readBack = readIssueRecordSync(project, issueId);
      // The writer always refreshes `updated`; verify no other field is dropped.
      const expected = { ...original, updated: readBack?.updated };
      expect(readBack).toEqual(expected);
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it('only allows raw state-write primitives in the approved pan-dir writer files', () => {
    // Extract the Rule 1 allowlist from the guard script so the test stays in
    // sync with the actual enforcement.
    const script = join(REPO_ROOT, 'scripts', 'lint-state-writes.sh');
    const scriptSrc = execFileSync('cat', [script], { encoding: 'utf-8' });
    const allowlist = new Set<string>();
    const excludeRe = /^\s*':!src\/lib\/pan-dir\/(.+?)'\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = excludeRe.exec(scriptSrc)) !== null) {
      allowlist.add(`src/lib/pan-dir/${m[1]}`);
    }

    const grep = execFileSync(
      'git',
      [
        'grep', '-nE',
        '-e', 'writeFileString',
        '-e', 'writeFileSync',
        '-e', 'writeFile\\(',
        '-e', '\\.rename\\(',
        '-e', 'renameSync',
        '--', 'src/lib/pan-dir/', ':!src/lib/pan-dir/__tests__/*',
      ],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    );

    const hits = grep
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.split(':')[0]);

    const offenders = hits.filter((file) => !allowlist.has(file));
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.error('Files with raw state-write primitives outside the approved writer allowlist:');
      // eslint-disable-next-line no-console
      console.error([...new Set(offenders)].join('\n'));
    }
    expect(offenders).toHaveLength(0);
  });

  it('guard script passes against the real repository', () => {
    const result = execFileSync('bash', [join(REPO_ROOT, 'scripts', 'lint-state-writes.sh')], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    expect(result).toContain('✓ state-write lint passed');
  });
});
