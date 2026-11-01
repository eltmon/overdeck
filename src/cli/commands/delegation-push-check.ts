/**
 * Unpushed commits before delegating to another machine (PAN-4651 FR-2,
 * D-4651-7; epic D-11). The other machine starts from its own view of
 * `origin`, so commits that exist only here would be missing there.
 *
 * Counts `git rev-list --count @{u}..HEAD` in the parent's working directory.
 * More than zero refuses with the exact re-run choices, unless `--push-first`
 * (runs `git push` and proceeds only on exit 0) or `--ignore-unpushed`. A
 * branch with no upstream counts as zero, with a one-line note. Every git call
 * is an async `execFile` with a timeout.
 */
import { execFile as nodeExecFile } from 'node:child_process';

export type GitRunner = (args: readonly string[], cwd: string, timeoutMs: number) => Promise<{ stdout: string }>;

export const runGit: GitRunner = (args, cwd, timeoutMs) =>
  new Promise((resolve, reject) => {
    nodeExecFile('git', [...args], { cwd, timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error) reject(Object.assign(error, { stdout: String(stdout ?? '') }));
      else resolve({ stdout: String(stdout) });
    });
  });

export interface PushCheckOptions {
  /** The machine the work will start on, for the message. */
  label: string;
  pushFirst?: boolean;
  ignoreUnpushed?: boolean;
}

export type PushCheckResult = { ok: true; note: string | null } | { ok: false; message: string };

export async function checkUnpushedCommits(cwd: string, options: PushCheckOptions, git: GitRunner = runGit): Promise<PushCheckResult> {
  if (options.ignoreUnpushed) return { ok: true, note: null };
  let count: number;
  try {
    count = Number.parseInt((await git(['rev-list', '--count', '@{u}..HEAD'], cwd, 10_000)).stdout.trim(), 10) || 0;
  } catch {
    return { ok: true, note: `This branch has no upstream; ${options.label} starts from origin's default branch state.` };
  }
  if (count === 0) return { ok: true, note: null };
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 10_000).catch(() => ({ stdout: 'HEAD' }))).stdout.trim() || 'HEAD';
  if (options.pushFirst) {
    try {
      await git(['push'], cwd, 120_000);
      return { ok: true, note: `Pushed ${count} commit${count === 1 ? '' : 's'} on ${branch}.` };
    } catch (error) {
      return { ok: false, message: `git push failed, so nothing was started on ${options.label}: ${(error as Error).message.split('\n')[0]}` };
    }
  }
  const commits = count === 1 ? '1 commit' : `${count} commits`;
  return {
    ok: false,
    message: `${commits} on ${branch} ${count === 1 ? 'is' : 'are'} not pushed; ${options.label} starts from origin. Re-run with --push-first to push them, or --ignore-unpushed.`,
  };
}
