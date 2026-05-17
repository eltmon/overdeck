import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { deriveProjectRoot, flushAutoCommits, queueAutoCommit } from '../auto-commit.js';

describe('auto-commit', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-'));
    execSync('git init -q', { cwd: tmp });
    execSync('git config user.email t@e.t', { cwd: tmp });
    execSync('git config user.name "Test"', { cwd: tmp });
    execSync('git config commit.gpgsign false', { cwd: tmp });
    // Seed an initial commit so HEAD has a valid ref before any auto-commit
    // attempts to add files to the index.
    writeFileSync(join(tmp, 'README.md'), 'seed');
    execSync('git add README.md', { cwd: tmp });
    execSync('git commit -q -m "init"', { cwd: tmp });
    // Rename whatever the default branch is to `main` so the gate fires.
    execSync('git branch -M main', { cwd: tmp });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('commits a queued .pan file change on main', async () => {
    mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
    const path = join(tmp, '.pan', 'continues', 'pan-1.vbrief.json');
    writeFileSync(path, '{"issue":"PAN-1"}');

    queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): update continue for PAN-1' });
    const result = await flushAutoCommits(tmp);

    expect(result.committed).toBe(true);
    const log = execSync('git log --oneline -1', { cwd: tmp, encoding: 'utf-8' });
    expect(log).toContain('chore(state): update continue for PAN-1');
  });

  it('does not commit when on a non-main branch', async () => {
    execSync('git checkout -q -b feature/foo', { cwd: tmp });
    mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
    const path = join(tmp, '.pan', 'continues', 'pan-2.vbrief.json');
    writeFileSync(path, '{"issue":"PAN-2"}');

    queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): noop branch test' });
    const result = await flushAutoCommits(tmp);

    expect(result.committed).toBe(false);
    expect(result.reason).toMatch(/not on main/);
  });

  it('coalesces a burst of writes into a single commit', async () => {
    mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
    const p1 = join(tmp, '.pan', 'continues', 'pan-3.vbrief.json');
    const p2 = join(tmp, '.pan', 'continues', 'pan-4.vbrief.json');
    writeFileSync(p1, '{"issue":"PAN-3"}');
    writeFileSync(p2, '{"issue":"PAN-4"}');

    queueAutoCommit({ projectRoot: tmp, paths: [p1], subject: 'chore(state): a' });
    queueAutoCommit({ projectRoot: tmp, paths: [p2], subject: 'chore(state): b' });
    const result = await flushAutoCommits(tmp);
    expect(result.committed).toBe(true);

    const log = execSync('git log --oneline', { cwd: tmp, encoding: 'utf-8' });
    // Two seed lines + exactly one auto-commit
    expect(log.split('\n').filter(Boolean).length).toBe(2);
  });

  it('is a no-op when the staged diff is empty', async () => {
    mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
    const path = join(tmp, '.pan', 'continues', 'pan-5.vbrief.json');
    writeFileSync(path, '{"issue":"PAN-5"}');
    execSync('git add .pan/', { cwd: tmp });
    execSync('git commit -q -m "pre-commit"', { cwd: tmp });

    queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): nothing changed' });
    const result = await flushAutoCommits(tmp);

    expect(result.committed).toBe(false);
    expect(result.reason).toBe('no diff');
  });

  it('is a no-op outside a git repo', async () => {
    const noGitTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-nogit-'));
    try {
      queueAutoCommit({ projectRoot: noGitTmp, paths: [join(noGitTmp, 'x')], subject: 'chore(state): no repo' });
      const result = await flushAutoCommits(noGitTmp);
      expect(result.committed).toBe(false);
      expect(result.reason).toBe('not a git repo');
    } finally {
      rmSync(noGitTmp, { recursive: true, force: true });
    }
  });
});

describe('deriveProjectRoot', () => {
  it('extracts project root from a .pan/specs/ path', () => {
    expect(deriveProjectRoot('/work/myproj/.pan/specs/foo.vbrief.json')).toBe('/work/myproj');
  });

  it('extracts project root from a .pan/continues/ path', () => {
    expect(deriveProjectRoot('/work/myproj/.pan/continues/pan-1.vbrief.json')).toBe('/work/myproj');
  });

  it('extracts project root from a .beads/ path', () => {
    expect(deriveProjectRoot('/work/myproj/.beads/issues.jsonl')).toBe('/work/myproj');
  });

  it('returns null for unrelated paths', () => {
    expect(deriveProjectRoot('/work/myproj/src/lib/foo.ts')).toBeNull();
  });
});
