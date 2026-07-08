import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function reconcileFileSizeBaseline(
  worktreePath: string,
  runGit: (args: string[], cwd: string) => Promise<{ stdout: string }>,
): Promise<{ changed: boolean }> {
  await execFileAsync('bash', ['scripts/lint-file-size.sh', '--update'], {
    cwd: worktreePath,
    maxBuffer: 16 * 1024 * 1024,
  });

  const { stdout } = await runGit(['status', '--porcelain', '--', 'scripts/file-size-baseline.txt'], worktreePath);
  if (stdout.trim() === '') return { changed: false };

  await runGit(['add', 'scripts/file-size-baseline.txt'], worktreePath);
  return { changed: true };
}
