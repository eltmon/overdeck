import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { classifyVerificationHead, isSameVerificationHead } from '../verification-head.js';

let root: string;
let workspace: string;
let upstream: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf-8' }).trim();
}

function commit(cwd: string, file: string): string {
  writeFileSync(join(cwd, file), file);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', file);
  return git(cwd, 'rev-parse', 'HEAD');
}

const roots = () => [{ repoKey: 'pan-1', dir: workspace, targetBranch: 'main' }];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'verification-head-'));
  const origin = join(root, 'origin.git');
  workspace = join(root, 'workspace');
  upstream = join(root, 'upstream');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, upstream], { stdio: 'ignore' });
  git(upstream, 'checkout', '-q', '-b', 'main');
  commit(upstream, 'base');
  git(upstream, 'push', '-q', 'origin', 'main');
  execFileSync('git', ['clone', '-q', origin, workspace], { stdio: 'ignore' });
  git(workspace, 'checkout', '-q', '-b', 'feature/pan-1');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Advance origin/main from another clone and fetch it into the workspace. */
function advanceMain(): void {
  commit(upstream, `main-${Date.now()}-${Math.random()}`);
  git(upstream, 'push', '-q', 'origin', 'main');
  git(workspace, 'fetch', '-q', 'origin', 'main');
}

describe('classifyVerificationHead (PAN-4527)', () => {
  it('an unchanged head is the same head', async () => {
    const launch = commit(workspace, 'a');
    expect(await classifyVerificationHead(roots(), launch, launch)).toBe('same');
  });

  it("the worker's own target-branch sync merge is still the launch head", async () => {
    const launch = commit(workspace, 'a');
    advanceMain();
    git(workspace, 'merge', '-q', '--no-edit', 'origin/main');
    const synced = git(workspace, 'rev-parse', 'HEAD');

    const relation = await classifyVerificationHead(roots(), launch, synced);
    expect(relation).toBe('synced');
    expect(isSameVerificationHead(relation)).toBe(true);
  });

  it('a fast-forward onto origin/main is still the launch head', async () => {
    const launch = git(workspace, 'rev-parse', 'HEAD');
    advanceMain();
    git(workspace, 'merge', '-q', '--no-edit', 'origin/main');

    expect(await classifyVerificationHead(roots(), launch, git(workspace, 'rev-parse', 'HEAD'))).toBe('synced');
  });

  it('an agent commit since launch is a moved head', async () => {
    const launch = commit(workspace, 'a');
    const agentCommit = commit(workspace, 'b');

    const relation = await classifyVerificationHead(roots(), launch, agentCommit);
    expect(relation).toBe('moved');
    expect(isSameVerificationHead(relation)).toBe(false);
  });

  it('an agent commit on top of the sync merge is a moved head', async () => {
    const launch = commit(workspace, 'a');
    advanceMain();
    git(workspace, 'merge', '-q', '--no-edit', 'origin/main');
    const agentCommit = commit(workspace, 'b');

    expect(await classifyVerificationHead(roots(), launch, agentCommit)).toBe('moved');
  });

  it('an unreadable head is unknown, and unknown is not the same head', async () => {
    const launch = commit(workspace, 'a');
    expect(await classifyVerificationHead(roots(), undefined, launch)).toBe('unknown');
    expect(await classifyVerificationHead(roots(), launch, 'f'.repeat(40))).toBe('unknown');
    expect(isSameVerificationHead('unknown')).toBe(false);
  });

  it('classifies a composite polyrepo anchor per repo', async () => {
    const launch = commit(workspace, 'a');
    const agentCommit = commit(workspace, 'b');
    const polyRoots = [{ repoKey: 'fe', dir: workspace, targetBranch: 'main' }];

    expect(await classifyVerificationHead(polyRoots, `fe@${launch}`, `fe@${launch}`)).toBe('same');
    expect(await classifyVerificationHead(polyRoots, `fe@${launch}`, `fe@${agentCommit}`)).toBe('moved');
  });
});
