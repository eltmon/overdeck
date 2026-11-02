/**
 * Push a workspace's feature branch to origin with an explicit refspec (PAN-4683).
 *
 * A workspace's `feature/<id>` branch tracks `origin/main`, so a bare
 * `git push` fails ("upstream branch does not match"), and `-u` would retarget
 * `@{u}`, which git-state, continue-state and lanes read. This never sets the
 * upstream, never forces, never skips hooks, and reports instead of throwing.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PUSH_TIMEOUT_MS = 120_000;

export interface FeatureBranchPushResult {
  pushed: boolean;
  reason?: string;
}

function firstStderrLine(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error);
  return text.trim().split('\n')[0] ?? 'push failed';
}

export async function pushFeatureBranch(input: {
  cwd: string;
  branch: string;
  execImpl?: typeof execFileAsync;
}): Promise<FeatureBranchPushResult> {
  const { cwd, branch } = input;
  const exec = input.execImpl ?? execFileAsync;

  let head: string;
  try {
    head = (await exec('git', ['symbolic-ref', '--short', 'HEAD'], { cwd })).stdout.trim();
  } catch {
    return { pushed: false, reason: 'HEAD is detached' };
  }
  if (head !== branch) return { pushed: false, reason: `HEAD is on ${head}, expected ${branch}` };

  try {
    const { stdout } = await exec('git', ['remote'], { cwd });
    if (!stdout.split('\n').some(line => line.trim() === 'origin')) return { pushed: false, reason: 'no origin remote' };
  } catch (error) {
    return { pushed: false, reason: firstStderrLine(error) };
  }

  try {
    await exec('git', ['push', 'origin', `HEAD:refs/heads/${branch}`], { cwd, timeout: PUSH_TIMEOUT_MS });
    return { pushed: true };
  } catch (error) {
    return { pushed: false, reason: firstStderrLine(error) };
  }
}
