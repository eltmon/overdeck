import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { driftNote as cliDriftNote } from '../../../../src/cli/commands/vault/resume.js';
import { driftFields, driftNote, inspectContinue } from '../../../../src/lib/vault/continue-inspect.js';
import type { CwdState } from '../../../../src/lib/vault/cwd-state.js';
import type { SessionRecord, WipSnapshotRef } from '../../../../src/lib/vault/format.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}

const CAPTURED: WipSnapshotRef = {
  base: 'b'.repeat(40),
  branch: 'main',
  tree: 't'.repeat(40),
  objects: ['o'.repeat(40)],
  bytes: 2048,
  at: '2026-09-29T10:00:00.000Z',
};

function record(options: { wip?: WipSnapshotRef; cwdState?: CwdState | null } = {}): SessionRecord {
  return {
    v: 1,
    type: 'session',
    vaultId: 'v-1',
    owner: { environmentId: 'env-a', label: 'desktop' },
    harness: 'claude-code',
    nativeSessionId: 'sess-1',
    title: 'Fix the parser',
    model: null,
    project: null,
    cwd: '/nowhere',
    gitOrigin: null,
    log: ['a'.repeat(40)],
    view: { fromChunk: 0, fromLine: 0 },
    parent: null,
    segments: [],
    settlements: [{
      at: '2026-09-29T10:00:00.000Z',
      chunk: 'a'.repeat(40),
      turn: 1,
      lines: 1,
      cwdState: options.cwdState ?? null,
      ...(options.wip ? { wip: options.wip } : {}),
    }],
    lineage: [],
    tombstone: false,
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    endedAt: null,
  };
}

describe('inspectContinue (PAN-4437 WI-1)', () => {
  let root: string;
  let repo: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'continue-inspect-'));
    repo = join(root, 'repo');
    await git(root, 'init', '-q', '-b', 'main', repo);
    await git(repo, 'config', 'user.name', 'Test');
    await git(repo, 'config', 'user.email', 'test@example.com');
    await writeFile(join(repo, 'a.txt'), 'one\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'init');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('ac1: a clean checkout with a captured snapshot places the code in place with no drift', async () => {
    const saved: CwdState = { gitOrigin: 'x', head: 'y', branch: 'other', dirty: true, staged: 1, unstaged: 0, untracked: 0, conflicted: 0 };
    const inspection = await inspectContinue(record({ wip: CAPTURED, cwdState: saved }), repo);
    expect(inspection.codePlacement).toBe('in-place');
    expect(inspection.drift).toEqual([]);
    expect(inspection.isGit).toBe(true);
    expect(inspection.dirty).toBe(false);
    expect(inspection.wip).toMatchObject({ kind: 'captured', at: CAPTURED.at, bytes: 2048, branch: 'main', base: 'b'.repeat(40) });
  });

  it('ac2: a dirty checkout goes to a new workspace and no git object is written', async () => {
    await writeFile(join(repo, 'a.txt'), 'changed\n');
    await writeFile(join(repo, 'new.txt'), 'untracked\n');
    const before = await git(repo, 'count-objects', '-v');
    const inspection = await inspectContinue(record({ wip: CAPTURED }), repo);
    const after = await git(repo, 'count-objects', '-v');
    expect(inspection.codePlacement).toBe('new-workspace');
    expect(inspection.dirty).toBe(true);
    expect(after).toBe(before);
  });

  it('ac3: a non-git directory places no code', async () => {
    const plain = join(root, 'plain');
    await mkdir(plain);
    const inspection = await inspectContinue(record({ wip: CAPTURED }), plain);
    expect(inspection.codePlacement).toBe('none');
    expect(inspection.isGit).toBe(false);
    expect(inspection.drift).toEqual([]);
  });

  it('ac3: a skipped entry places no code and carries the CLI reason text', async () => {
    const inspection = await inspectContinue(record({ wip: { skipped: 'too-large', reason: '12 MB over the cap' } }), repo);
    expect(inspection.codePlacement).toBe('none');
    expect(inspection.wip).toEqual({ kind: 'skipped', reason: 'too-large, 12 MB over the cap' });
    const bare = await inspectContinue(record({ wip: { skipped: 'secret' } }), repo);
    expect(bare.wip).toEqual({ kind: 'skipped', reason: 'secret' });
  });

  it('reports drift fields when no code is placed', async () => {
    const head = (await git(repo, 'rev-parse', 'HEAD')).trim();
    const saved: CwdState = { gitOrigin: null, head, branch: 'feature', dirty: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
    const inspection = await inspectContinue(record({ cwdState: saved }), repo);
    expect(inspection.wip).toEqual({ kind: 'none' });
    expect(inspection.codePlacement).toBe('none');
    expect(inspection.drift).toEqual(['branch']);
  });
});

describe('driftFields', () => {
  const current: CwdState = { gitOrigin: null, head: 'h', branch: 'main', dirty: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  const saved: CwdState = { ...current, branch: 'dev' };

  it('is empty when code is placed, the settlement has no cwdState, or the target is not git', () => {
    expect(driftFields(record({ cwdState: saved }), current, true)).toEqual([]);
    expect(driftFields(record(), current, false)).toEqual([]);
    expect(driftFields(record({ cwdState: saved }), null, false)).toEqual([]);
    expect(driftFields(record({ cwdState: saved }), current, false)).toEqual(['branch']);
  });
});

describe('driftNote', () => {
  it('ac4: returns the exact sentence resume produced, and resume re-exports it', () => {
    expect(driftNote(['branch'])).toBe(
      '[Session Vault] This conversation was resumed in a working directory whose branch differs from where it was saved. Check the current state before relying on earlier assumptions.',
    );
    expect(driftNote(['head', 'dirty'])).toBe(
      '[Session Vault] This conversation was resumed in a working directory whose head, dirty differ from where it was saved. Check the current state before relying on earlier assumptions.',
    );
    expect(cliDriftNote).toBe(driftNote);
  });
});
