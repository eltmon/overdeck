import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGit } from '../git-exec.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function repo(files: Record<string, string>): Promise<FixtureRepo> {
  const r = await makeFixtureRepo(files);
  cleanups.push(r.cleanup);
  return r;
}

describe('runGit', () => {
  it('runs in the given cwd', async () => {
    const r = await repo({ 'sub/a.txt': 'a' });
    const result = await runGit(join(r.dir, 'sub'), ['rev-parse', '--show-prefix']);
    expect(result.code).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('sub/\n');
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it('writes input to stdin', async () => {
    const r = await repo({ '.gitignore': '*.log\n' });
    const result = await runGit(r.dir, ['check-ignore', '-z', '--stdin'], { input: 'a.log\0b.txt\0' });
    expect(result.code).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('a.log\0');
  });

  it('caps stdout at maxBytes and marks the result truncated', async () => {
    const r = await repo({ 'alpha.txt': 'a', 'beta.txt': 'b' });
    const result = await runGit(r.dir, ['ls-files', '-z'], { maxBytes: 4 });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(4);
  });

  it('treats pathspec magic characters literally', async () => {
    const r = await repo({ 'a.ts': 'a', 'b.ts': 'b' });
    const result = await runGit(r.dir, ['ls-files', '-z', '--', '*.ts']);
    expect(result.code).toBe(0);
    expect(result.stdout.toString('utf8')).toBe('');
  });

  it('returns code 128 outside a repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'explorer-norepo-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const result = await runGit(dir, ['rev-parse', '--show-toplevel']);
    expect(result.code).toBe(128);
    expect(result.stderr).toMatch(/not a git repository/i);
  });
});
