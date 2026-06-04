import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync as unlink } from 'fs';
import { deriveProjectRoot, flushAutoCommits, queueAutoCommit, queueBeadsAutoCommit } from '../auto-commit.js';

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

  it.effect('commits a queued .pan file change on main', () =>
    Effect.gen(function* () {
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const path = join(tmp, '.pan', 'continues', 'pan-1.vbrief.json');
      writeFileSync(path, '{"issue":"PAN-1"}');

      queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): update continue for PAN-1' });
      const result = yield* flushAutoCommits(tmp);

      expect(result.committed).toBe(true);
      const log = execSync('git log --oneline -1', { cwd: tmp, encoding: 'utf-8' });
      expect(log).toContain('chore(state): update continue for PAN-1');
    }),
  );

  it.effect('does not commit when on a non-main branch', () =>
    Effect.gen(function* () {
      execSync('git checkout -q -b feature/foo', { cwd: tmp });
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const path = join(tmp, '.pan', 'continues', 'pan-2.vbrief.json');
      writeFileSync(path, '{"issue":"PAN-2"}');

      queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): noop branch test' });
      const result = yield* flushAutoCommits(tmp);

      expect(result.committed).toBe(false);
      expect(result.reason).toMatch(/not on main/);
    }),
  );

  it.effect('coalesces a burst of writes into a single commit', () =>
    Effect.gen(function* () {
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const p1 = join(tmp, '.pan', 'continues', 'pan-3.vbrief.json');
      const p2 = join(tmp, '.pan', 'continues', 'pan-4.vbrief.json');
      writeFileSync(p1, '{"issue":"PAN-3"}');
      writeFileSync(p2, '{"issue":"PAN-4"}');

      queueAutoCommit({ projectRoot: tmp, paths: [p1], subject: 'chore(state): a' });
      queueAutoCommit({ projectRoot: tmp, paths: [p2], subject: 'chore(state): b' });
      const result = yield* flushAutoCommits(tmp);
      expect(result.committed).toBe(true);

      const log = execSync('git log --oneline', { cwd: tmp, encoding: 'utf-8' });
      // Two seed lines + exactly one auto-commit
      expect(log.split('\n').filter(Boolean).length).toBe(2);
    }),
  );

  it.effect('is a no-op when the staged diff is empty', () =>
    Effect.gen(function* () {
      mkdirSync(join(tmp, '.pan', 'continues'), { recursive: true });
      const path = join(tmp, '.pan', 'continues', 'pan-5.vbrief.json');
      writeFileSync(path, '{"issue":"PAN-5"}');
      execSync('git add .pan/', { cwd: tmp });
      execSync('git commit -q -m "pre-commit"', { cwd: tmp });

      queueAutoCommit({ projectRoot: tmp, paths: [path], subject: 'chore(state): nothing changed' });
      const result = yield* flushAutoCommits(tmp);

      expect(result.committed).toBe(false);
      expect(result.reason).toBe('no diff');
    }),
  );

  it.effect('is a no-op outside a git repo', () =>
    Effect.gen(function* () {
      const noGitTmp = mkdtempSync(join(tmpdir(), 'pan-autocommit-nogit-'));
      try {
        queueAutoCommit({ projectRoot: noGitTmp, paths: [join(noGitTmp, 'x')], subject: 'chore(state): no repo' });
        const result = yield* flushAutoCommits(noGitTmp);
        expect(result.committed).toBe(false);
        expect(result.reason).toBe('not a git repo');
      } finally {
        rmSync(noGitTmp, { recursive: true, force: true });
      }
    }),
  );
});

describe('queueBeadsAutoCommit (PAN-1441)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-beads-autocommit-'));
    execSync('git init -q', { cwd: tmp });
    execSync('git config user.email t@e.t', { cwd: tmp });
    execSync('git config user.name "Test"', { cwd: tmp });
    execSync('git config commit.gpgsign false', { cwd: tmp });
    writeFileSync(join(tmp, 'README.md'), 'seed');
    execSync('git add README.md', { cwd: tmp });
    execSync('git commit -q -m "init"', { cwd: tmp });
    execSync('git branch -M main', { cwd: tmp });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it.effect('commits drifted beads export files on main', () =>
    Effect.gen(function* () {
      mkdirSync(join(tmp, '.beads'), { recursive: true });
      writeFileSync(join(tmp, '.beads', 'issues.jsonl'), '{"id":"PAN-1"}\n');
      writeFileSync(join(tmp, '.beads', 'export-state.json'), '{"issues":1}');

      queueBeadsAutoCommit(tmp);
      const result = yield* flushAutoCommits(tmp);

      expect(result.committed).toBe(true);
      const show = execSync('git show --stat --oneline HEAD', { cwd: tmp, encoding: 'utf-8' });
      expect(show).toContain('chore(beads): sync beads state on main');
      expect(show).toContain('.beads/issues.jsonl');
      expect(show).toContain('.beads/export-state.json');
    }),
  );

  it.effect('skips a deleted issues.jsonl so it never propagates an empty-DB deletion (PAN-1158)', () =>
    Effect.gen(function* () {
      mkdirSync(join(tmp, '.beads'), { recursive: true });
      writeFileSync(join(tmp, '.beads', 'issues.jsonl'), '{"id":"PAN-1"}\n');
      writeFileSync(join(tmp, '.beads', 'export-state.json'), '{"issues":1}');
      execSync('git add .beads/', { cwd: tmp });
      execSync('git commit -q -m "seed beads"', { cwd: tmp });

      // issues.jsonl transiently disappears; export-state changes.
      unlink(join(tmp, '.beads', 'issues.jsonl'), { force: true });
      writeFileSync(join(tmp, '.beads', 'export-state.json'), '{"issues":0}');

      queueBeadsAutoCommit(tmp);
      const result = yield* flushAutoCommits(tmp);

      expect(result.committed).toBe(true);
      // The commit touched export-state only; the issues.jsonl deletion was NOT staged.
      const show = execSync('git show --stat --oneline HEAD', { cwd: tmp, encoding: 'utf-8' });
      expect(show).toContain('.beads/export-state.json');
      expect(show).not.toContain('.beads/issues.jsonl');
      // issues.jsonl is still tracked at HEAD (deletion not propagated).
      const tracked = execSync('git ls-files .beads/issues.jsonl', { cwd: tmp, encoding: 'utf-8' });
      expect(tracked.trim()).toBe('.beads/issues.jsonl');
    }),
  );

  it.effect('no-ops when no beads files exist', () =>
    Effect.gen(function* () {
      queueBeadsAutoCommit(tmp);
      const result = yield* flushAutoCommits(tmp);
      expect(result.committed).toBe(false);
      expect(result.reason).toBe('no pending');
    }),
  );
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
