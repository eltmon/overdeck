/**
 * PAN-5357 WI-2: `pan backlog write-sequence` adds no commit when only
 * `generatedAt` would change. Uses a real git repo so the commit count is
 * proof, not a mock assertion.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/overdeck/plan-artifact-push-report.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/overdeck/plan-artifact-push-report.js')>(
    '../../../lib/overdeck/plan-artifact-push-report.js',
  );
  return { ...actual, surfacePlanArtifactPush: vi.fn().mockResolvedValue(null) };
});

vi.mock('../../../lib/overdeck/plan-artifact-commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/overdeck/plan-artifact-commit.js')>(
    '../../../lib/overdeck/plan-artifact-commit.js',
  );
  return { ...actual, pushPlanArtifacts: vi.fn().mockResolvedValue({ pushed: false, skipped: true, reason: 'nothing ahead' }) };
});

import { backlogWriteSequenceCommand } from '../backlog-write-sequence.js';
import { writeSequenceMd } from '../../../lib/backlog/sequence-io.js';
import type { SequenceDoc } from '../../../lib/backlog/types.js';

let tmp: string;
let docsDir: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: tmp, encoding: 'utf8' });
}

function commitCount(): number {
  return Number(git('rev-list', '--count', 'HEAD').trim());
}

function writeDocFile(path: string, doc: SequenceDoc): void {
  writeFileSync(path, JSON.stringify(doc), 'utf-8');
}

const SAMPLE_DOC: SequenceDoc = {
  version: 1,
  project: 'overdeck',
  generatedAt: '2026-06-19T00:00:00Z',
  model: 'claude-opus-4-8',
  pass: 'creation',
  openCount: 1,
  nodes: [
    { issue: 'PAN-1', rank: 1, size: 'M', importance: 'high', score: 90, condition: 'ok', dependsOn: [], why: 'Foundation.', gate: 'auto', planning: 'auto' },
  ],
  edges: [],
};

describe('backlogWriteSequenceCommand', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'write-seq-cli-'));
    // The JSON input file lives outside the git repo so it never shows up as
    // an untracked file in `git status --porcelain`.
    docsDir = mkdtempSync(join(tmpdir(), 'write-seq-cli-doc-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@overdeck.local');
    git('config', 'user.name', 'Overdeck Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(tmp, 'README.md'), 'seed\n', 'utf-8');
    git('add', '-A');
    git('commit', '-q', '-m', 'chore: seed');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(docsDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('unchanged ranking produces no commit', async () => {
    const docFile = join(docsDir, 'doc.json');
    writeDocFile(docFile, SAMPLE_DOC);
    await backlogWriteSequenceCommand(docFile, { projectRoot: tmp });
    const countAfterFirst = commitCount();

    writeDocFile(docFile, { ...SAMPLE_DOC, generatedAt: '2026-06-20T00:00:00Z' });
    const logSpy = vi.spyOn(console, 'log');
    await backlogWriteSequenceCommand(docFile, { projectRoot: tmp });

    expect(commitCount()).toBe(countAfterFirst);
    expect(git('status', '--porcelain').trim()).toBe('');
    expect(logSpy.mock.calls.flat().join('\n')).toContain('not committed');
  });

  it('changed ranking commits once', async () => {
    const docFile = join(docsDir, 'doc.json');
    writeDocFile(docFile, SAMPLE_DOC);
    await backlogWriteSequenceCommand(docFile, { projectRoot: tmp });
    const countAfterFirst = commitCount();

    writeDocFile(docFile, { ...SAMPLE_DOC, generatedAt: '2026-06-20T00:00:00Z', nodes: [{ ...SAMPLE_DOC.nodes[0]!, rank: 2 }] });
    await backlogWriteSequenceCommand(docFile, { projectRoot: tmp });

    expect(commitCount()).toBe(countAfterFirst + 1);
    expect(git('log', '-1', '--format=%s').trim()).toBe('chore(workspace): backlog sequence');
  });

  it('an unchanged re-run commits an earlier uncommitted write', async () => {
    const docFile = join(docsDir, 'doc.json');
    writeDocFile(docFile, SAMPLE_DOC);
    await backlogWriteSequenceCommand(docFile, { projectRoot: tmp });
    const countAfterFirst = commitCount();

    // Write directly so sequence.md changes without a commit.
    const uncommitted: SequenceDoc = { ...SAMPLE_DOC, generatedAt: '2026-06-21T00:00:00Z', nodes: [{ ...SAMPLE_DOC.nodes[0]!, rank: 2 }] };
    writeSequenceMd(tmp, uncommitted);
    expect(git('status', '--porcelain').trim()).not.toBe('');

    writeDocFile(docFile, uncommitted);
    const logSpy = vi.spyOn(console, 'log');
    await backlogWriteSequenceCommand(docFile, { projectRoot: tmp });

    expect(commitCount()).toBe(countAfterFirst + 1);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('committed an earlier uncommitted sequence write');
  });
});
