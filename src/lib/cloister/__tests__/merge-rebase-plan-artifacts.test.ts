/**
 * PAN-4225 (review finding, non-blocking): per-issue continue/spec writers
 * now target the issue's base workspace, and the server never commits its
 * own writes — so a server-dirtied `.pan/continues/<ISSUE>.xbrief.json` can
 * sit tracked-but-modified in the workspace at merge time. An in-place
 * `git rebase origin/main` refuses outright with any tracked file dirty.
 * rebaseFeatureBranchBody must commit that pending artifact before it
 * rebases, the same way `pan done` already does.
 *
 * Real git against a local bare remote; no network.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rebaseFeatureBranch } from '../merge-rebase.js';

const BRANCH = 'feature/pan-77';
const ISSUE = 'PAN-77';

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

function commit(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), `${content}\n`);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', message);
}

describe('rebaseFeatureBranch commits a dirty .pan/continues before an in-place rebase (PAN-4225)', () => {
  let root: string;
  let remote: string;
  let work: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rebase-plan-artifacts-'));
    remote = join(root, 'remote.git');
    work = join(root, 'work');
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    git(root, 'clone', '-q', remote, work);
    git(work, 'config', 'user.name', 't');
    git(work, 'config', 'user.email', 't@t');
    git(work, 'checkout', '-q', '-b', 'main');
    commit(work, 'base.txt', 'base', 'base');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', '-b', BRANCH);
    mkdirSync(join(work, '.pan', 'continues'), { recursive: true });
    commit(work, '.pan/continues/PAN-77.xbrief.json', '{"version":"1"}', 'seed continue file');
    commit(work, 'feature.txt', 'feature', 'feature work');
    git(work, 'push', '-q', 'origin', BRANCH);

    // main advances so the feature branch is behind and a real rebase runs.
    const other = join(root, 'other');
    git(root, 'clone', '-q', remote, other);
    git(other, 'config', 'user.name', 't');
    git(other, 'config', 'user.email', 't@t');
    commit(other, 'main-advance.txt', 'advance', 'advance main');
    git(other, 'push', '-q', 'origin', 'main');

    // A server writer dirtied the tracked continue file without committing.
    writeFileSync(join(work, '.pan', 'continues', 'PAN-77.xbrief.json'), '{"version":"1","dirty":true}\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('commits the dirty continue file and completes the rebase instead of refusing', async () => {
    const result = await Effect.runPromise(rebaseFeatureBranch(work, BRANCH, 'main', ISSUE));

    expect(result.success).toBe(true);
    // The dirty content survived, committed rather than dropped or blocking.
    const content = git(work, 'show', 'HEAD:.pan/continues/PAN-77.xbrief.json');
    expect(content).toContain('"dirty":true');
    expect(git(work, 'status', '--porcelain')).toBe('');
  });
});
