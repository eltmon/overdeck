/**
 * PAN-4614: concurrent PRs that each append a bullet to
 * `.overdeck/context/codebase/concerns.md` conflict under git's default
 * 3-way merge. `.gitattributes` now marks that file `merge=union`.
 *
 * Real git against a local bare remote; no network.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rebaseFeatureBranch } from '../merge-rebase.js';
import { probeBranchConflictPaths } from '../conflict-gate.js';

const BRANCH = 'feature/pan-77';
const ISSUE = 'PAN-77';
const CONCERNS_PATH = '.overdeck/context/codebase/concerns.md';

const REPO_GITATTRIBUTES = readFileSync(
  fileURLToPath(new URL('../../../../.gitattributes', import.meta.url)),
  'utf-8',
);

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
}

function write(cwd: string, path: string, content: string): void {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

function commit(cwd: string, path: string, content: string, message: string): void {
  write(cwd, path, content);
  git(cwd, 'add', path);
  git(cwd, 'commit', '-q', '-m', message);
}

const BASE_CONCERNS = '# Concerns / hazards\n\n- base one\n- base two\n<!-- last-verified: 2026-10-01 -->\n';

/**
 * Builds: a bare remote, a `work` clone with a `feature/pan-77` branch that
 * appends `- feature bullet`, and a second `other` clone that advances
 * `main` with `- main bullet` at the same insertion point — so the control
 * fixture (no attribute) conflicts and the union fixture does not.
 */
function setup(attributes: string): { root: string; remote: string; work: string } {
  const root = mkdtempSync(join(tmpdir(), 'rebase-union-concerns-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, work);
  git(work, 'config', 'user.name', 't');
  git(work, 'config', 'user.email', 't@t');
  git(work, 'checkout', '-q', '-b', 'main');
  write(work, '.gitattributes', attributes);
  write(work, CONCERNS_PATH, BASE_CONCERNS);
  git(work, 'add', '.gitattributes', CONCERNS_PATH);
  git(work, 'commit', '-q', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'main');

  git(work, 'checkout', '-q', '-b', BRANCH);
  commit(
    work,
    CONCERNS_PATH,
    BASE_CONCERNS.replace('- base two\n', '- base two\n- feature bullet\n'),
    'feature: add feature bullet',
  );
  git(work, 'push', '-q', 'origin', BRANCH);

  const other = join(root, 'other');
  git(root, 'clone', '-q', remote, other);
  git(other, 'config', 'user.name', 't');
  git(other, 'config', 'user.email', 't@t');
  commit(
    other,
    CONCERNS_PATH,
    BASE_CONCERNS.replace('- base two\n', '- base two\n- main bullet\n'),
    'main: add main bullet',
  );
  git(other, 'push', '-q', 'origin', 'main');

  return { root, remote, work };
}

describe('concerns.md union merge (PAN-4614)', () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rebases in place with both bullets kept (union)', async () => {
    const fixture = setup(REPO_GITATTRIBUTES);
    root = fixture.root;

    const result = await Effect.runPromise(rebaseFeatureBranch(fixture.work, BRANCH, 'main', ISSUE));

    expect(result.success).toBe(true);
    const content = git(fixture.work, 'show', `HEAD:${CONCERNS_PATH}`);
    expect(content).toContain('- main bullet');
    expect(content).toContain('- feature bullet');
    expect(content).not.toContain('<<<<<<<');
  });

  it('rebases the approved head in a server worktree with both bullets kept (union)', async () => {
    const fixture = setup(REPO_GITATTRIBUTES);
    root = fixture.root;
    const head = git(fixture.work, 'rev-parse', 'HEAD');

    const result = await Effect.runPromise(
      rebaseFeatureBranch(fixture.work, BRANCH, 'main', ISSUE, { expectedHead: head }),
    );

    expect(result.success).toBe(true);
    const content = git(fixture.remote, 'show', `refs/heads/${BRANCH}:${CONCERNS_PATH}`);
    expect(content).toContain('- main bullet');
    expect(content).toContain('- feature bullet');
  });

  it('the conflict probe reports clean (union)', async () => {
    const fixture = setup(REPO_GITATTRIBUTES);
    root = fixture.root;

    const probe = await probeBranchConflictPaths(fixture.work, 'main');

    expect(probe).toEqual({ mergeability: 'clean', paths: [] });
  });

  it('control: the same appends conflict without the attribute', async () => {
    const fixture = setup('');
    root = fixture.root;

    const err = await Effect.runPromise(
      Effect.flip(rebaseFeatureBranch(fixture.work, BRANCH, 'main', ISSUE)),
    );

    expect(err._tag).toBe('MergeConflictError');
    expect((err as { conflictedFiles: readonly string[] }).conflictedFiles).toContain(CONCERNS_PATH);
  });
});
