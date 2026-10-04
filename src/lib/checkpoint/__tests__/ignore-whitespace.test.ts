import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { execFileSync } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  captureCheckpoint,
  diffAgainstMain,
  diffAgainstMainFiles,
  diffCheckpointFiles,
  diffCheckpoints,
} from '../checkpoint-manager.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf-8' });
}

describe('ignoreWhitespace in the agent diff helpers (PAN-4503)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'pan-4503-agent-'));
    git(repo, 'init', '-q', '-b', 'main');
    await writeFile(join(repo, 'a.js'), 'if (x) {\nfoo()\n}\n');
    await writeFile(join(repo, 'b.txt'), 'hi\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    await Effect.runPromise(captureCheckpoint(repo, 'agent-ws', 't1'));
    await writeFile(join(repo, 'a.js'), 'if (x) {\n    foo()\n}\n');
    await writeFile(join(repo, 'b.txt'), 'hi\nthere\n');
    await Effect.runPromise(captureCheckpoint(repo, 'agent-ws', 't2'));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('drops the re-indent-only file from the per-turn patch', async () => {
    const ignored = await Effect.runPromise(
      diffCheckpoints(repo, 'agent-ws', 't1', 't2', undefined, { ignoreWhitespace: true }),
    );
    expect(ignored).toContain('b.txt');
    expect(ignored).not.toContain('a.js');

    const plain = await Effect.runPromise(diffCheckpoints(repo, 'agent-ws', 't1', 't2'));
    expect(plain).toContain('b.txt');
    expect(plain).toContain('a.js');
  });

  it('drops the re-indent-only file from the checkpoint file list', async () => {
    const files = await Effect.runPromise(
      diffCheckpointFiles(repo, 'agent-ws', 't1', 't2', { ignoreWhitespace: true }),
    );
    expect(files.map((f) => f.path)).toEqual(['b.txt']);

    const plain = await Effect.runPromise(diffCheckpointFiles(repo, 'agent-ws', 't1', 't2'));
    expect(plain.map((f) => f.path)).toEqual(['a.js', 'b.txt']);
  });

  it('drops the re-indent-only file from the vs-main file list and patch', async () => {
    git(repo, 'checkout', '-q', '-b', 'feature');
    git(repo, 'commit', '-q', '-am', 'change');

    const files = await diffAgainstMainFiles(repo, { ignoreWhitespace: true });
    expect(files.map((f) => f.path)).toEqual(['b.txt']);
    expect(await diffAgainstMain(repo, 'a.js', { ignoreWhitespace: true })).toBe('');

    expect((await diffAgainstMainFiles(repo)).map((f) => f.path)).toEqual(['a.js', 'b.txt']);
    expect(await diffAgainstMain(repo, 'a.js')).toContain('a.js');
  });
});
