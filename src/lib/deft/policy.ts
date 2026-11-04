/**
 * Deft's merge policy for the auto-merge hold (PAN-4820 WI-9, AD-15).
 *
 * Deft records whether a human must merge in its project definition,
 * `xbrief/PROJECT-DEFINITION.xbrief.json`, under `plan["x-directive/policy"]`
 * (legacy key `plan.policy`). Overdeck follows Deft's own resolution order:
 * a typed `requireHumanMerge` wins; a present but malformed value means true;
 * when absent, `autoDeployOnMerge === true` means true; else false. A missing
 * or unreadable file means unknown, which also holds auto-merge (D6: "on or
 * unknown ⇒ auto-merge off"). `DEFT_ALLOW_BOT_MERGE` is ignored.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getIssueWorkspacePath } from '../overdeck/issue-projects.js';
import { isDeftPipelineIssue } from './issue-pipeline.js';

export interface DeftPolicyRead {
  /** The policy object, or null when the readable file has none. */
  policy: Record<string, unknown> | null;
  /** False when the project definition is missing or cannot be parsed. */
  readable: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export async function readDeftPolicy(worktree: string): Promise<DeftPolicyRead> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(worktree, 'xbrief', 'PROJECT-DEFINITION.xbrief.json'), 'utf8'));
  } catch {
    return { policy: null, readable: false };
  }
  const plan = isRecord(parsed) ? parsed.plan : undefined;
  const policy = isRecord(plan) ? (plan['x-directive/policy'] ?? plan.policy) : undefined;
  return { policy: isRecord(policy) ? policy : null, readable: true };
}

export function requireHumanMergeOf(read: DeftPolicyRead): boolean {
  if (!read.readable) return true;
  const policy = read.policy ?? {};
  if (Object.prototype.hasOwnProperty.call(policy, 'requireHumanMerge')) {
    const value = policy.requireHumanMerge;
    return typeof value === 'boolean' ? value : true;
  }
  return policy.autoDeployOnMerge === true;
}

export interface DeftAutoMergeHoldDeps {
  isDeft?: (issueId: string) => Promise<boolean>;
  workspacePath?: (issueId: string) => string | null;
}

/** The reason auto-merge must not act on this issue, or null. */
export async function deftAutoMergeHold(issueId: string, deps: DeftAutoMergeHoldDeps = {}): Promise<string | null> {
  if (!(await (deps.isDeft ?? isDeftPipelineIssue)(issueId))) return null;
  const worktree = (deps.workspacePath ?? getIssueWorkspacePath)(issueId);
  const read = worktree ? await readDeftPolicy(worktree) : { policy: null, readable: false };
  return requireHumanMergeOf(read) ? `${issueId.toUpperCase()} runs on Deft and requires a human merge` : null;
}
