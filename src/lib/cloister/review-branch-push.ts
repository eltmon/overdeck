import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  resolveWorkspaceRepoRootsSync,
  type WorkspaceRepoRoot,
} from '../project-repos.js';

const execFileAsync = promisify(execFile);
const REVIEW_PUSH_TIMEOUT_MS = 30_000;

export interface ReviewGitCommandOptions {
  cwd: string;
  timeout: number;
  killSignal: NodeJS.Signals;
  env: NodeJS.ProcessEnv;
}

export type ReviewGitRunner = (
  args: string[],
  options: ReviewGitCommandOptions,
) => Promise<void>;

async function runReviewGit(args: string[], options: ReviewGitCommandOptions): Promise<void> {
  await execFileAsync('git', args, options);
}

function reviewGitOptions(cwd: string): ReviewGitCommandOptions {
  return {
    cwd,
    timeout: REVIEW_PUSH_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'true',
      SSH_ASKPASS: 'true',
    },
  };
}

export async function pushLocalReviewBranches(
  issueId: string,
  workspacePath: string,
  dependencies: {
    resolveRoots?: (issueId: string, workspacePath: string) => WorkspaceRepoRoot[];
    runGit?: ReviewGitRunner;
  } = {},
): Promise<void> {
  const roots = (dependencies.resolveRoots ?? resolveWorkspaceRepoRootsSync)(issueId, workspacePath);
  const runGit = dependencies.runGit ?? runReviewGit;
  for (const root of roots) {
    try {
      await runGit(
        ['rev-parse', '--verify', '--quiet', `refs/heads/${root.sourceBranch}`],
        reviewGitOptions(root.dir),
      );
    } catch {
      continue;
    }
    await runGit(['push', 'origin', root.sourceBranch], reviewGitOptions(root.dir));
  }
}
