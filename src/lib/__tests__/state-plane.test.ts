import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMainDivergence,
  isStatePlaneOnlyDiff,
  isStatePlaneOnlyStatus,
  parsePorcelainStatusPaths,
} from '../state-plane.js';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();
}

function commitAll(root: string, message: string): string {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message, '--quiet']);
  return git(root, ['rev-parse', 'HEAD']);
}

function configureGit(root: string): void {
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
}

function createBareOrigin(root: string): string {
  const remote = mkdtempSync(join(tmpdir(), 'state-plane-remote-'));
  execFileSync('git', ['init', '--bare', '--quiet'], { cwd: remote });
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '--quiet', '-u', 'origin', 'main']);
  return remote;
}

describe('isStatePlaneOnlyDiff', () => {
  let root: string;
  let base: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'state-plane-'));
    git(root, ['init', '--quiet']);
    configureGit(root);
    writeFileSync(join(root, 'README.md'), 'base\n');
    base = commitAll(root, 'base');
    git(root, ['branch', '-M', 'main']);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns true when the diff touches only state-plane paths', async () => {
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    mkdirSync(join(root, '.beads'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'pan-2375.json'), '{}\n');
    writeFileSync(join(root, '.beads', 'issues.jsonl'), '{"id":"PAN-2375"}\n');
    const tip = commitAll(root, 'state only');

    await expect(isStatePlaneOnlyDiff(base, tip, root)).resolves.toBe(true);
  });

  it('returns false when any non-state path changes', async () => {
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'pan-2375.json'), '{}\n');
    writeFileSync(join(root, 'src', 'feature.ts'), 'export const feature = true;\n');
    const tip = commitAll(root, 'mixed state and source');

    await expect(isStatePlaneOnlyDiff(base, tip, root)).resolves.toBe(false);
  });

  it('returns false for a diff that touches only .pan/drafts/', async () => {
    mkdirSync(join(root, '.pan', 'drafts'), { recursive: true });
    writeFileSync(join(root, '.pan', 'drafts', 'PAN-2375.md'), '# Draft\n');
    const tip = commitAll(root, 'draft only');

    await expect(isStatePlaneOnlyDiff(base, tip, root)).resolves.toBe(false);
  });

  it('returns true for an empty diff between identical SHAs', async () => {
    await expect(isStatePlaneOnlyDiff(base, base, root)).resolves.toBe(true);
  });
});

describe('parsePorcelainStatusPaths', () => {
  it('returns an empty path list for clean porcelain output', () => {
    expect(parsePorcelainStatusPaths('')).toEqual([]);
    expect(isStatePlaneOnlyStatus('')).toBe(true);
  });

  it('extracts paths from staged, unstaged, and untracked state-plane status lines', () => {
    const porcelain = [
      'MM .pan/records/pan-1982.json',
      ' M .pan/test/result.json',
      '?? .pan/feedback/review.json',
    ].join('\n');

    expect(parsePorcelainStatusPaths(porcelain)).toEqual([
      '.pan/records/pan-1982.json',
      '.pan/test/result.json',
      '.pan/feedback/review.json',
    ]);
    expect(isStatePlaneOnlyStatus(porcelain)).toBe(true);
  });

  it('returns false when any porcelain status path is outside the state plane', () => {
    const porcelain = [
      ' M .pan/records/pan-1982.json',
      ' M src/foo.ts',
    ].join('\n');

    expect(isStatePlaneOnlyStatus(porcelain)).toBe(false);
  });

  it('uses both paths for state-plane renames', () => {
    const porcelain = 'R  .pan/records/a.json -> .pan/records/b.json';

    expect(parsePorcelainStatusPaths(porcelain)).toEqual([
      '.pan/records/a.json',
      '.pan/records/b.json',
    ]);
    expect(isStatePlaneOnlyStatus(porcelain)).toBe(true);
  });

  it('returns false for a rename with either path outside the state plane', () => {
    const porcelain = 'R  .pan/records/a.json -> src/a.json';

    expect(parsePorcelainStatusPaths(porcelain)).toEqual([
      '.pan/records/a.json',
      'src/a.json',
    ]);
    expect(isStatePlaneOnlyStatus(porcelain)).toBe(false);
  });

  it('returns false for a source-to-state rename', () => {
    const porcelain = 'R  src/foo.ts -> .pan/records/foo.ts';

    expect(parsePorcelainStatusPaths(porcelain)).toEqual([
      'src/foo.ts',
      '.pan/records/foo.ts',
    ]);
    expect(isStatePlaneOnlyStatus(porcelain)).toBe(false);
  });

  it('returns false for a source deletion', () => {
    const porcelain = ' D src/foo.ts';

    expect(parsePorcelainStatusPaths(porcelain)).toEqual(['src/foo.ts']);
    expect(isStatePlaneOnlyStatus(porcelain)).toBe(false);
  });

  it('unquotes git C-quoted porcelain paths', () => {
    const porcelain = [
      ' M ".pan/records/pan\\040quoted.json"',
      '?? ".pan/test/result\\011copy.json"',
    ].join('\n');

    expect(parsePorcelainStatusPaths(porcelain)).toEqual([
      '.pan/records/pan quoted.json',
      '.pan/test/result\tcopy.json',
    ]);
    expect(isStatePlaneOnlyStatus(porcelain)).toBe(true);
  });
});

describe('getMainDivergence', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'state-plane-divergence-'));
    git(root, ['init', '--quiet']);
    configureGit(root);
    writeFileSync(join(root, 'README.md'), 'base\n');
    commitAll(root, 'base');
    git(root, ['branch', '-M', 'main']);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns ahead count when local main has unpushed commits', async () => {
    const remote = createBareOrigin(root);
    try {
      writeFileSync(join(root, 'LOCAL.md'), 'local\n');
      commitAll(root, 'local commit');

      await expect(getMainDivergence(root)).resolves.toEqual({ ahead: 1, behind: 0 });
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });

  it('returns behind count when origin/main is ahead of local main', async () => {
    const remote = createBareOrigin(root);
    const other = mkdtempSync(join(tmpdir(), 'state-plane-other-'));
    try {
      execFileSync('git', ['clone', '--quiet', '-b', 'main', remote, other]);
      configureGit(other);
      writeFileSync(join(other, 'REMOTE.md'), 'remote\n');
      execFileSync('git', ['add', 'REMOTE.md'], { cwd: other });
      execFileSync('git', ['commit', '--quiet', '-m', 'remote commit'], { cwd: other });
      execFileSync('git', ['push', '--quiet', 'origin', 'main'], { cwd: other });
      git(root, ['fetch', '--quiet', 'origin', 'main']);

      await expect(getMainDivergence(root)).resolves.toEqual({ ahead: 0, behind: 1 });
    } finally {
      rmSync(remote, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('returns zero divergence on git errors', async () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'state-plane-not-repo-'));
    try {
      await expect(getMainDivergence(notRepo)).resolves.toEqual({ ahead: 0, behind: 0 });
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });
});
