import chalk from 'chalk';
import type { Command } from 'commander';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { killCommand } from './kill.js';
import { resetSessionCommand } from './reset-session.js';
import { getAgentDir, getAgentStateSync, listRunningAgentsSync } from '../../lib/agents.js';
import { resolveBareNumericIdSync } from '../../lib/issue-id.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { findPlanSync } from '../../lib/vbrief/io.js';
import { resetPipelineVerdictsForWorkStartSync } from '../../lib/review-status.js';
import { dequeueMerge } from '../../lib/overdeck/merge.js';
import { resetPostMergeState } from '../../lib/cloister/merge-agent.js';
import { IssueLifecycle, IssueLifecycleWithClientLive } from '../../dashboard/server/services/issue-lifecycle.js';

export interface ResetToPlannedOptions { dryRun?: boolean }

export function registerResetToPlannedCommand(program: Command): void {
  program.command('reset-to-planned <id>')
    .description('Return a finalized issue to post-planning without deleting its workspace, plan, beads, commits, or branch')
    .option('--dry-run', 'Show the exact reset without changing state')
    .action(resetToPlannedCommand);
}

export async function resetToPlannedCommand(id: string, options: ResetToPlannedOptions = {}): Promise<void> {
  const issueId = resolveBareNumericIdSync(id);
  if (!issueId) throw new Error(`Could not resolve issue ID "${id}"`);

  const project = resolveProjectFromIssueSync(issueId);
  if (!project) throw new Error(`Could not resolve project for ${issueId}`);
  const workspace = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  if (!existsSync(workspace)) throw new Error(`Workspace not found: ${workspace}`);
  if (!findPlanSync(workspace)) throw new Error(`${issueId} has no finalized plan; refusing to manufacture a post-planning state`);

  const agents = listRunningAgentsSync().filter((agent) => agent.issueId.toUpperCase() === issueId.toUpperCase());
  console.log(chalk.bold(`${options.dryRun ? 'Would reset' : 'Resetting'} ${issueId} to post-planning`));
  console.log(`  workspace: ${workspace}`);
  console.log(`  live sessions: ${agents.filter((agent) => agent.tmuxActive).map((agent) => agent.id).join(', ') || 'none'}`);
  console.log('  preserved: branch, commits, workspace, active plan, beads');
  console.log('  cleared: work/swarm/specialist sessions, saved work session, verdicts, retries, merge queue');
  if (options.dryRun) return;

  await killCommand(issueId, { force: true });

  const primaryAgentId = `agent-${issueId.toLowerCase()}`;
  if (getAgentStateSync(primaryAgentId)) await resetSessionCommand(issueId);
  for (const marker of ['completed', 'completed.processed', 'completion.md']) {
    const path = join(getAgentDir(primaryAgentId), marker);
    if (existsSync(path)) unlinkSync(path);
  }

  resetPipelineVerdictsForWorkStartSync(issueId, { force: true });
  dequeueMerge(project.projectKey, issueId);
  resetPostMergeState(issueId);

  await Effect.runPromise(
    Effect.gen(function* () {
      const lifecycle = yield* IssueLifecycle;
      yield* lifecycle.transitionTo(issueId, 'open');
      yield* lifecycle.addLabel(issueId, 'planned');
    }).pipe(Effect.provide(IssueLifecycleWithClientLive)),
  );

  console.log(chalk.green(`\n✓ ${issueId} is post-planning and no agent was spawned.`));
  console.log(`  Next action: pan start ${issueId}`);
}
