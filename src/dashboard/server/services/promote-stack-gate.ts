/**
 * PAN-4753 WI-9 (#3176): refuse to promote a batch whose UAT stack is not
 * running when UAT is required for it.
 *
 * UAT is required when the generation's project holds merges for UAT
 * (`projectHoldsForUat`: its `auto_merge_default`, else the global
 * `require_uat_before_merge`), or when any member's issue policy is Hold (its
 * `hold-for-uat` label). Then the stack is probed (`probeUatStack`): anything
 * but `running` (`degraded`, `unknown`, `absent`) refuses the promote with
 * `stack-unhealthy`, which the promote route maps to 409.
 *
 * The operator can merge anyway with a non-empty reason. The override is
 * journaled on each member's workspace as a `merge.attempted` entry
 * (`source: 'batch-promote'`), and the promote continues.
 *
 * An auto project whose members carry no Hold label never probes. That is
 * the path batch auto-promote takes (`batch-auto-promote.ts`), with no
 * override, so automatic window batches are never held by this gate.
 */
import { autoMergeFromLabels } from '../../../lib/cloister/auto-merge-eligibility.js';
import { projectHoldsForUat } from '../../../lib/cloister/auto-merge-policy.js';
import { appendPipelineEntry } from '../../../lib/cloister/pipeline-journal.js';
import type { PromoteResult } from '../../../lib/cloister/uat-promote.js';
import { probeUatStack, type UatStackStatus } from '../../../lib/cloister/uat-stack.js';
import type { UatGeneration } from '../../../lib/overdeck/merge-types.js';
import { isFlywheelRequireUatBeforeMerge } from '../../../lib/overdeck/control-settings.js';
import type { ProjectConfig } from '../../../lib/projects.js';
import { getWorkspaceInfoForIssue } from '../routes/workspaces.js';
import { cachedIssueLabels } from './auto-merge-door-policy.js';

export interface StackHealthOverride {
  reason: string;
}

export interface PromoteStackGateDeps {
  probe: (gen: UatGeneration) => Promise<{ status: UatStackStatus }>;
  globalRequireUat: () => boolean;
  issueLabels: (issueId: string) => readonly string[];
  /** The member's local workspace, or null (remote or gone): the journal lives there. */
  workspacePathOf: (issueId: string) => string | null;
  appendJournal: typeof appendPipelineEntry;
}

function defaultDeps(): PromoteStackGateDeps {
  return {
    probe: (gen) => probeUatStack(gen),
    globalRequireUat: isFlywheelRequireUatBeforeMerge,
    issueLabels: cachedIssueLabels,
    workspacePathOf: (issueId) => {
      const info = getWorkspaceInfoForIssue(issueId);
      return !info.isRemote && info.localPath ? info.localPath : null;
    },
    appendJournal: appendPipelineEntry,
  };
}

/** Whether promoting this generation needs a tested, running UAT stack. */
export function batchRequiresUat(
  gen: Pick<UatGeneration, 'members'>,
  project: ProjectConfig | null | undefined,
  deps: Pick<PromoteStackGateDeps, 'globalRequireUat' | 'issueLabels'>,
): boolean {
  if (projectHoldsForUat(project, deps.globalRequireUat())) return true;
  return gen.members.some((member) => autoMergeFromLabels(deps.issueLabels(member.issueId.toUpperCase())) === false);
}

/**
 * The `stack-unhealthy` refusal, or null to continue the promote. With an
 * override, an unhealthy stack journals the override per member and continues.
 */
export async function promoteStackHealthRefusal(
  gen: UatGeneration,
  project: ProjectConfig | null | undefined,
  override: StackHealthOverride | undefined,
  deps: PromoteStackGateDeps = defaultDeps(),
): Promise<(PromoteResult & { success: false }) | null> {
  if (!batchRequiresUat(gen, project, deps)) return null;
  const { status } = await deps.probe(gen);
  if (status === 'running') return null;
  if (!override) {
    return {
      success: false,
      reason: 'stack-unhealthy',
      message: `UAT stack is ${status}; start it and test, or merge anyway with a reason`,
    };
  }
  for (const member of gen.members) {
    const issueId = member.issueId.toUpperCase();
    const workspacePath = deps.workspacePathOf(issueId);
    if (!workspacePath) continue;
    deps.appendJournal(workspacePath, {
      type: 'merge.attempted',
      issueId,
      source: 'batch-promote',
      data: { batch: gen.name, overrideStackHealth: true, reason: override.reason, stackStatus: status },
    });
  }
  return null;
}
