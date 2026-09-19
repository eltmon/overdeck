/**
 * pan admin migrate-plan-home <project-key> (PAN-3917, D8, w1-plan-home).
 *
 * One-time bridge tool: copies planning artifacts for OPEN issues from the
 * legacy `~/.overdeck/state/<project>/` worktree into `<planHome>/.pan/`,
 * and carries each open issue's `records/` item-status overrides into its
 * `.pan/continues/<ISSUE>.xbrief.json` `items` map. Never writes to the
 * state worktree, never deletes anything, never pushes.
 */
import type { Command } from 'commander';
import { Effect } from 'effect';

import { exitCli } from '../../exit.js';
import { loadConfigSync } from '../../../lib/config.js';
import { getIssuePrefix, getProjectSync, type ProjectConfig } from '../../../lib/projects.js';
import { createTracker } from '../../../lib/tracker/factory.js';
import type { Issue, TrackerType } from '../../../lib/tracker/interface.js';
import {
  migratePanHome,
  readOpenIssuesFile,
  resolveMigrationTargets,
} from '../../../lib/pan-dir/migrate-plan-home.js';

export interface MigratePlanHomeCliOptions {
  commit?: boolean;
  dryRun?: boolean;
  stateRoot?: string;
  planHome?: string;
  openIssues?: string;
}

/** Mirrors `pipeline-membership-gather.ts`'s tracker resolution (not exported there). */
function resolveProjectTrackerType(project: ProjectConfig): TrackerType {
  if (project.tracker) return project.tracker;
  if (project.rally_project) return 'rally';
  if (project.github_repo) return 'github';
  if (getIssuePrefix(project)) return 'linear';
  if (project.gitlab_repo) return 'gitlab';
  throw new Error(`Cannot resolve tracker for ${project.name}`);
}

/** Live open-issue list for a registered project, filtered to this project's issue prefix. */
async function listOpenIssuesFromTracker(project: ProjectConfig): Promise<string[]> {
  const trackerType = resolveProjectTrackerType(project);
  const issuePrefix = getIssuePrefix(project)?.toUpperCase();
  if (!issuePrefix) throw new Error(`Missing issue_prefix for project ${project.name}`);

  const trackerConfig = loadConfigSync().trackers[trackerType];
  const tracker = createTracker({
    type: trackerType,
    apiKeyEnv: trackerConfig && 'api_key_env' in trackerConfig ? trackerConfig.api_key_env : undefined,
    tokenEnv: trackerConfig && 'token_env' in trackerConfig ? trackerConfig.token_env : undefined,
    team: issuePrefix,
    owner: project.github_repo?.split('/')[0],
    repo: project.github_repo?.split('/')[1],
    projectId: project.gitlab_repo,
    server: trackerType === 'rally' && trackerConfig && 'server' in trackerConfig ? trackerConfig.server : undefined,
    workspace: trackerType === 'rally' && trackerConfig && 'workspace' in trackerConfig ? trackerConfig.workspace : undefined,
    project: project.rally_project,
  });

  const issues = await Effect.runPromise(tracker.listIssues({ team: issuePrefix, includeClosed: true }));

  return issues
    .filter((issue: Issue) => issue.state !== 'closed')
    .map((issue: Issue) => issue.ref.toUpperCase())
    .filter((ref: string) => ref.startsWith(`${issuePrefix}-`));
}

export async function runMigratePlanHome(projectKey: string, options: MigratePlanHomeCliOptions): Promise<number> {
  let stateRoot: string;
  let planHome: string;
  try {
    ({ stateRoot, planHome } = resolveMigrationTargets({
      project: projectKey,
      stateRoot: options.stateRoot,
      planHome: options.planHome,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let openIssues: string[];
  if (options.openIssues) {
    openIssues = readOpenIssuesFile(options.openIssues);
  } else {
    const project = getProjectSync(projectKey);
    if (!project) {
      console.error(`migrate-plan-home: project "${projectKey}" is not registered; pass --open-issues <file> instead`);
      return 1;
    }
    try {
      openIssues = await listOpenIssuesFromTracker(project);
    } catch (error) {
      console.error(`migrate-plan-home: tracker lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
  console.log(`Found ${openIssues.length} open issue(s) for ${projectKey}.`);

  const result = await migratePanHome({
    stateRoot,
    planHome,
    openIssues,
    commit: options.commit,
    dryRun: options.dryRun,
  });

  const verb = options.dryRun ? 'would copy' : 'copied';
  console.log(
    `${verb} ${result.copied.length}, unchanged ${result.unchanged}, `
    + `skipped ${result.skippedClosed} closed-issue file(s), ${result.remaining} remaining`,
  );
  console.log(`Progress copied for ${result.progressUpdated.length} issue(s).`);
  if (result.copied.length > 0) {
    for (const rel of result.copied) console.log(`  ${verb === 'copied' ? 'copied' : 'would copy'}: ${rel}`);
  }
  if (result.committed) console.log('Committed.');

  if (options.dryRun) return 0;
  return result.remaining === 0 ? 0 : 1;
}

export function registerMigratePlanHomeCommand(admin: Command): void {
  admin
    .command('migrate-plan-home <project-key>')
    .description(
      'One-time bridge: copy open-issue planning artifacts and item progress from '
      + '~/.overdeck/state/<project>/ into <planHome>/.pan/ (PAN-3917 D8)',
    )
    .option('--commit', 'Commit the copied artifacts in the plan home')
    .option('--dry-run', 'Preview what would be copied without writing anything')
    .option('--state-root <dir>', 'Override the state worktree root (tests / odd setups)')
    .option('--plan-home <dir>', 'Override the plan home (tests / odd setups)')
    .option('--open-issues <file>', 'Read open issue ids from a file instead of calling the tracker')
    .action(async (projectKey: string, options: MigratePlanHomeCliOptions) => {
      const code = await runMigratePlanHome(projectKey, options);
      if (code !== 0) return exitCli(code);
    });
}
