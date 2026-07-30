/**
 * Where the bot's HTTPS git credentials live, and how to find the repo they
 * belong to.
 *
 * `git config credential.helper` is repo-scoped, NOT worktree-scoped: every
 * worktree of a repo shares one value. Pointing it inside a worktree's own git
 * dir therefore means the last workspace configured wins, and reaping that
 * workspace deletes the credential file AND its parent directory out from under
 * every other worktree — after which the whole repo fails every push with
 * "unable to get credential storage lock ... No such file or directory".
 *
 * That is how the `overdeck-state` branch silently accumulated 144 unpushed
 * commits behind a reaped `feature-pan-3320-strike` worktree (2026-07-30). One
 * file per repo, outside every git dir, keeps the path valid for the life of
 * the repo no matter which workspaces come and go.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getOverdeckHome } from './paths.js';

/**
 * The credential-store file for a repo, with its directory created. Stable
 * across worktree churn, so a reaped workspace cannot strand it.
 */
export function ensureBotCredentialFile(owner: string, repo: string): string {
  const file = join(getOverdeckHome(), 'credentials', `${owner}-${repo}`);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return file;
}

/** owner/repo from a workspace's `origin` remote (https or ssh form). */
export async function resolveWorkspaceRemote(
  workspacePath: string,
): Promise<{ owner: string; repo: string }> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  const { stdout } = await execAsync('git remote get-url origin', {
    cwd: workspacePath,
    encoding: 'utf-8',
  });
  const match = stdout.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Cannot parse a GitHub owner/repo from origin: ${stdout.trim()}`);
  }
  return { owner: match[1]!, repo: match[2]! };
}
