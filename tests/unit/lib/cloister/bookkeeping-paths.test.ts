/**
 * PAN-5356: the shared bookkeeping-path set, and the git check the merge-train
 * reconciler uses to keep a batch whose base moved by bookkeeping commits only.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  BOOKKEEPING_PATH_GLOBS,
  isBookkeepingOnlyMove,
  isBookkeepingPath,
  parseGitPathList,
} from '../../../../src/lib/cloister/bookkeeping-paths.js';
import { buildUatGenerationGitDeps } from '../../../../src/lib/cloister/uat-generation-deps.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

describe('BOOKKEEPING_PATH_GLOBS', () => {
  it('is exactly the CI push paths-ignore list', () => {
    const workflow = parse(readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
      on: { push: { 'paths-ignore': string[] } };
    };
    expect(workflow.on.push['paths-ignore']).toEqual([...BOOKKEEPING_PATH_GLOBS]);
  });

  it('holds only <dir>/** globs, the one shape the prefix matcher supports', () => {
    for (const glob of BOOKKEEPING_PATH_GLOBS) expect(glob).toMatch(/^[^*]+\/\*\*$/);
  });
});

describe('isBookkeepingPath', () => {
  it.each([
    ['.pan/backlog/sequence.md', true],
    ['.pan/specs/2026-11-15-PAN-1.xbrief.json', true],
    ['.overdeck/memory/fact.md', true],
    ['.overdeck/context/project.md', false],
    ['.panic/x', false],
    ['src/lib/cloister/uat-reconciler.ts', false],
    ['docs/.pan/x.md', false],
  ])('%s → %s', (path, expected) => {
    expect(isBookkeepingPath(path)).toBe(expected);
  });
});

describe('isBookkeepingOnlyMove', () => {
  const gitLogOutput = '\n.pan/backlog/sequence.md\n\n.pan/backlog/sequence.md\n\n.overdeck/memory/a.md\n';

  it('parses git --name-only output and accepts bookkeeping-only commits', () => {
    const touched = parseGitPathList(gitLogOutput);
    expect(touched).toEqual(['.pan/backlog/sequence.md', '.pan/backlog/sequence.md', '.overdeck/memory/a.md']);
    expect(isBookkeepingOnlyMove(touched, ['src/a.ts'])).toBe(true);
  });

  it('rejects any non-bookkeeping path', () => {
    expect(isBookkeepingOnlyMove(['.pan/x.md', 'src/a.ts'])).toBe(false);
  });

  it('rejects a bookkeeping path the batch also changes', () => {
    expect(isBookkeepingOnlyMove(['.pan/backlog/sequence.md'], ['.pan/backlog/sequence.md'])).toBe(false);
  });
});

describe('GenerationGitDeps.isBookkeepingOnlyBaseMove (real git)', () => {
  let repo = '';
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const commit = (files: Record<string, string>, message: string) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const check = (fromSha: string, toSha: string, batchBranch?: string) =>
    buildUatGenerationGitDeps(repo).isBookkeepingOnlyBaseMove!({ fromSha, toSha, ...(batchBranch ? { batchBranch } : {}) });

  let base = '';
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'pan-5356-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    base = commit({ 'src/a.ts': 'a', '.pan/backlog/sequence.md': 't0' }, 'base');
    git('switch', '-q', '-c', 'uat/pan-test-1115');
    commit({ 'src/b.ts': 'b' }, 'batch member');
    git('switch', '-q', 'main');
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('accepts a range of .pan/** commits', async () => {
    commit({ '.pan/backlog/sequence.md': 't1' }, 'chore: sequence');
    const head = commit({ '.overdeck/memory/x.md': 'fact' }, 'chore: memory');
    await expect(check(base, head, 'uat/pan-test-1115')).resolves.toBe(true);
  });

  it('rejects a code change even when a later commit reverts it', async () => {
    const before = git('rev-parse', 'HEAD');
    commit({ 'src/a.ts': 'changed' }, 'change');
    const head = commit({ 'src/a.ts': 'a' }, 'revert');
    await expect(check(before, head)).resolves.toBe(false);
  });

  it('rejects a move of a code file into .pan/', async () => {
    const before = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, '.pan', 'moved'), { recursive: true });
    renameSync(join(repo, 'src', 'a.ts'), join(repo, '.pan', 'moved', 'a.ts'));
    const head = commit({}, 'move');
    await expect(check(before, head)).resolves.toBe(false);
  });

  it('rejects a bookkeeping move that touches a file the batch changes', async () => {
    const before = git('rev-parse', 'HEAD');
    git('switch', '-q', '-c', 'uat/pan-overlap-1115');
    commit({ '.pan/notes.md': 'batch' }, 'batch note');
    git('switch', '-q', 'main');
    const head = commit({ '.pan/notes.md': 'main' }, 'main note');
    await expect(check(before, head, 'uat/pan-overlap-1115')).resolves.toBe(false);
  });

  it('rejects a base that is not an ancestor, and an unsafe sha', async () => {
    const head = git('rev-parse', 'HEAD');
    const side = git('rev-parse', 'uat/pan-test-1115');
    await expect(check(side, head)).resolves.toBe(false);
    await expect(check('--all', head)).resolves.toBe(false);
  });
});
