/**
 * PAN-3917 W9: whoever writes a `.pan/` artifact commits it. A commit that
 * fails must say so and must leave the index the way it found it — the verbs
 * above this helper turn a failure into a non-zero exit.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commitPlanArtifacts } from '../../../../src/lib/overdeck/plan-artifact-commit.js';

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function write(rel: string, content: string): void {
  const path = join(repo, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'plan-artifact-commit-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@overdeck.local');
  git('config', 'user.name', 'Overdeck Test');
  git('config', 'commit.gpgsign', 'false');
  write('README.md', 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: seed');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** A hook that refuses every commit, so the failure path is exercised for real. */
function refuseCommits(): void {
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "pre-commit refused"\nexit 1\n', 'utf8');
  chmodSync(hook, 0o755);
}

describe('commitPlanArtifacts', () => {
  it('commits the artifacts it was given', async () => {
    write('.pan/continues/PAN-1.xbrief.json', '{}\n');

    const result = await commitPlanArtifacts({ cwd: repo, paths: ['.pan/continues'], message: 'chore(workspace): x' });

    expect(result).toMatchObject({ committed: true });
    expect(git('show', '--name-only', '--format=', 'HEAD')).toContain('.pan/continues/PAN-1.xbrief.json');
  });

  it('reports an already-committed artifact as nothing to commit', async () => {
    write('.pan/continues/PAN-1.xbrief.json', '{}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'chore(workspace): earlier');

    const result = await commitPlanArtifacts({ cwd: repo, paths: ['.pan/continues'], message: 'chore(workspace): x' });
    expect(result).toEqual({ committed: false, reason: 'nothing to commit' });
  });

  it('reports the failure and unstages only what it staged', async () => {
    write('unrelated.txt', 'operator work\n');
    git('add', '--', 'unrelated.txt');
    write('.pan/continues/PAN-1.xbrief.json', '{}\n');
    refuseCommits();

    const result = await commitPlanArtifacts({ cwd: repo, paths: ['.pan/continues'], message: 'chore(workspace): x' });

    expect(result.committed).toBe(false);
    const staged = git('diff', '--cached', '--name-only');
    expect(staged).not.toContain('.pan/continues');
    expect(staged).toContain('unrelated.txt');
  });
});
