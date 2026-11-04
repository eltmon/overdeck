/**
 * The work kickoff for an issue on Deft Directive's pipeline (PAN-4820 WI-11).
 *
 * The agent runs Deft's own flow (AD-22): Deft's build, pre-PR and
 * review-cycle skills. The kickoff adds only what hosting needs: the state
 * archive (`pan skills deft save`), `pan sync-main` instead of a rebase, the
 * hidden tracked files, and that a person merges through Overdeck.
 *
 * The builder has no side effects (AD-2): it never installs. A worktree that
 * is neither a native Directive project nor carrying a temporary install
 * refuses, so the operator runs `pan skills deft use` first.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { renderPrompt } from '../cloister/prompts.js';
import { isNativeDirectiveProject } from './archive.js';
import { readDeftSnapshot } from './install-snapshot.js';

const execFileAsync = promisify(execFile);

/** The workspace's checked-out branch, else the conventional `feature/<issue>`. */
async function currentBranch(workspacePath: string, issueIdLower: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: workspacePath });
    return stdout.trim() || `feature/${issueIdLower}`;
  } catch {
    return `feature/${issueIdLower}`;
  }
}

export class DeftNotInstalledError extends Error {
  constructor(issueId: string) {
    super(`run pan skills deft use ${issueId.toUpperCase()}`);
    this.name = 'DeftNotInstalledError';
  }
}

export async function buildDeftWorkAgentPrompt(ctx: { issueId: string; workspacePath: string }): Promise<string> {
  const issueId = ctx.issueId.toUpperCase();
  const issueIdLower = issueId.toLowerCase();
  const snapshot = await readDeftSnapshot(ctx.workspacePath);
  if (!snapshot && !(await isNativeDirectiveProject(ctx.workspacePath))) throw new DeftNotInstalledError(issueId);
  const hidden = snapshot?.modifiedTracked.map(entry => entry.path) ?? [];
  return Effect.runPromise(renderPrompt({
    name: 'work-deft',
    vars: {
      ISSUE_ID: issueId,
      ISSUE_ID_LOWER: issueIdLower,
      WORKSPACE_PATH: ctx.workspacePath,
      BRANCH_NAME: await currentBranch(ctx.workspacePath, issueIdLower),
      HIDDEN_PATHS: hidden.length > 0 ? hidden.join(', ') : 'none',
    },
  }));
}
