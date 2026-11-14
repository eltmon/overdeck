import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { commitAll, headSha, isClean, pushHead, type OperatorIdentity } from '../edit-workspace-git.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

const execFileAsync = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];
const BASE = 'refs/remotes/origin/main';
const OP: OperatorIdentity = { name: 'Op', email: 'op@example.com' };
const fakeIdentity = async () => OP;

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A fixture repo whose origin is a local bare repository holding main. */
async function repoWithRemote(): Promise<{ repo: FixtureRepo; bare: string }> {
  const repo = await makeFixtureRepo({ 'README.md': 'hello\n' });
  cleanups.push(repo.cleanup);
  const bare = await tempDir('explorer-bare-');
  await execFileAsync('git', ['init', '-q', '--bare', bare]);
  await repo.git('remote', 'add', 'origin', bare);
  await repo.git('push', '-q', 'origin', 'main');
  await repo.git('fetch', '-q', 'origin');
  return { repo, bare };
}

describe('commitAll', () => {
  it('commits one modified file as the operator with the title as the message', async () => {
    const { repo } = await repoWithRemote();
    await writeFile(join(repo.dir, 'README.md'), 'changed\n');
    expect(await commitAll(repo.dir, 'chore: edit README.md', BASE, { operatorIdentity: fakeIdentity })).toEqual({ committed: true });
    expect((await repo.git('rev-list', '--count', `${BASE}..HEAD`)).trim()).toBe('1');
    expect((await repo.git('log', '-1', '--format=%s')).trim()).toBe('chore: edit README.md');
    expect((await repo.git('log', '-1', '--format=%an <%ae>')).trim()).toBe('Op <op@example.com>');
    expect(await isClean(repo.dir)).toBe(true);
  });

  it('commits as the repository identity when no operator identity is set', async () => {
    const { repo } = await repoWithRemote();
    await writeFile(join(repo.dir, 'new.txt'), 'n\n');
    await commitAll(repo.dir, 'chore: add new.txt', BASE, { operatorIdentity: async () => null });
    expect((await repo.git('log', '-1', '--format=%an <%ae>')).trim()).toBe('t <t@example.com>');
  });

  it('rejects NOTHING_TO_COMMIT with no changes and no commits ahead', async () => {
    const { repo } = await repoWithRemote();
    await expect(commitAll(repo.dir, 'chore: x', BASE, { operatorIdentity: fakeIdentity })).rejects.toMatchObject({
      code: 'NOTHING_TO_COMMIT',
      status: 409,
    });
  });

  it('resolves committed false with no changes and one commit ahead', async () => {
    const { repo } = await repoWithRemote();
    await repo.git('commit', '-q', '--allow-empty', '-m', 'ahead');
    expect(await commitAll(repo.dir, 'chore: x', BASE, { operatorIdentity: fakeIdentity })).toEqual({ committed: false });
  });

  it('rejects COMMIT_REFUSED with the hook stderr when commit-msg fails', async () => {
    const { repo } = await repoWithRemote();
    const hooks = await tempDir('explorer-hooks-');
    const hook = join(hooks, 'commit-msg');
    await writeFile(hook, '#!/bin/sh\necho nope >&2\nexit 1\n');
    await chmod(hook, 0o755);
    await repo.git('config', 'core.hooksPath', hooks);
    await writeFile(join(repo.dir, 'README.md'), 'changed\n');
    const error = await commitAll(repo.dir, 'Fix typo', BASE, { operatorIdentity: fakeIdentity }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'COMMIT_REFUSED', status: 422 });
    expect((error as Error).message).toContain('nope');
  });
});

describe('pushHead', () => {
  it('creates the branch on the remote and sets upstream', async () => {
    const { repo, bare } = await repoWithRemote();
    await repo.git('switch', '-q', '-c', 'scratch/edit-x');
    await repo.git('commit', '-q', '--allow-empty', '-m', 'edit');
    await pushHead(repo.dir, 'scratch/edit-x', { setUpstream: true });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'refs/heads/scratch/edit-x'], { cwd: bare });
    expect(stdout.trim()).toBe(await headSha(repo.dir));
    expect((await repo.git('rev-parse', '--abbrev-ref', '@{u}')).trim()).toBe('origin/scratch/edit-x');
  });

  it('rejects PUSH_FAILED when the remote is unreachable', async () => {
    const { repo } = await repoWithRemote();
    await repo.git('remote', 'set-url', 'origin', join(tmpdir(), 'explorer-missing-remote-does-not-exist'));
    await expect(pushHead(repo.dir, 'scratch/edit-x', { setUpstream: false })).rejects.toMatchObject({
      code: 'PUSH_FAILED',
      status: 502,
    });
  });
});
