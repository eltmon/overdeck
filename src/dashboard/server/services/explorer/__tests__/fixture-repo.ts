/**
 * Test helper: a throwaway git repository in the OS temp directory.
 * Not a test file. Used by the explorer service tests.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FixtureRepo {
  dir: string;
  /** Runs git in the repo and returns stdout. */
  git(...args: string[]): Promise<string>;
  cleanup(): Promise<void>;
}

export async function makeFixtureRepo(files: Record<string, string>): Promise<FixtureRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-'));
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('git', args, { cwd: dir });
    return stdout;
  };
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 't');
  await git('config', 'user.email', 't@example.com');
  await git('config', 'commit.gpgsign', 'false');
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  await git('add', '-A');
  await git('commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, git, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
