/**
 * pan admin migrate-plan-home <project-key> (PAN-3917, D8, w1-plan-home).
 *
 * One-time bridge tool: copies planning artifacts for OPEN issues from the
 * legacy `~/.overdeck/state/<project>/` worktree into `<planHome>/.pan/`,
 * and carries each open issue's `records/` item-status overrides into its
 * `.pan/continues/<ISSUE>.xbrief.json` `items` map. Never writes to the
 * state worktree, never deletes anything, never pushes.
 *
 * `--repair-ignore` (PAN-3996) does only the `.gitignore` repair: it removes
 * Overdeck's legacy `.pan/` line and commits `.gitignore` alone, with no copy
 * and no tracker lookup.
 */
import type { Command } from 'commander';
import { Effect } from 'effect';

import { exitCli } from '../../exit.js';
import { loadConfigSync } from '../../../lib/config.js';
import { getIssuePrefix, getProjectSync, type ProjectConfig } from '../../../lib/projects.js';
import { createTracker } from '../../../lib/tracker/factory.js';
import type { Issue, TrackerType } from '../../../lib/tracker/interface.js';
import { describePanIgnore } from '../../../lib/pan-dir/legacy-pan-ignore.js';
import {
  migratePanHome,
  readOpenIssuesFile,
  resolveMigrationTargets,
  type MigratePanHomeResult,
} from '../../../lib/pan-dir/migrate-plan-home.js';
import { repairLegacyPanIgnore } from '../../../lib/pan-dir/plan-home-commit.js';

export interface MigratePlanHomeCliOptions {
  commit?: boolean;
  dryRun?: boolean;
  repairIgnore?: boolean;
  forceRemigrate?: boolean;
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

/**
 * The `${issuePrefix}-<n>` id for one tracker issue.
 *
 * GitHub's `ref` is a bare `#<number>` (no team/prefix concept at the
 * tracker layer — Overdeck's own `issue_prefix` convention, e.g.
 * `PAN-<n>` == `eltmon/overdeck#<n>`, is layered on top), so it is combined
 * with `issuePrefix` here. Linear/GitLab/Rally already return a prefixed
 * identifier (e.g. `MIN-902`) as `ref`.
 */
export function issueIdFromTrackerIssue(issue: Issue, trackerType: TrackerType, issuePrefix: string): string {
  if (trackerType === 'github') {
    return `${issuePrefix.toUpperCase()}-${issue.ref.replace(/^#/, '')}`;
  }
  return issue.ref.toUpperCase();
}

/**
 * Open-issue ids (case-normalized `${issuePrefix}-<n>`) out of a tracker's
 * raw `listIssues` result. Pure — no tracker/network access — so it is unit
 * tested directly with fixtures shaped like each tracker's normalized
 * `Issue` output.
 */
export function filterOpenIssueIds(issues: readonly Issue[], trackerType: TrackerType, issuePrefix: string): string[] {
  const prefix = issuePrefix.toUpperCase();
  return issues
    .filter((issue) => issue.state !== 'closed')
    .map((issue) => issueIdFromTrackerIssue(issue, trackerType, prefix))
    .filter((ref) => ref.startsWith(`${prefix}-`));
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

  // No `limit`: paginate fully (github.ts and linear.ts both page to
  // exhaustion when limit is undefined).
  const issues = await Effect.runPromise(tracker.listIssues({ team: issuePrefix, includeClosed: true }));
  return filterOpenIssueIds(issues, trackerType, issuePrefix);
}

/**
 * What the run found and did about a plan home that ignores `.pan/`
 * (PAN-3996). Empty when `.pan/` is not ignored.
 */
export function panIgnoreReport(
  result: Pick<MigratePanHomeResult, 'panIgnore' | 'ignoreLinesRemoved'>,
  options: Pick<MigratePlanHomeCliOptions, 'commit' | 'dryRun'>,
): string[] {
  const status = result.panIgnore;
  if (status.kind === 'check-failed') {
    return [
      `Warning: could not check whether the plan home ignores .pan/ (${status.detail}).`,
      '  A --commit run needs that check and stops on the same error.',
    ];
  }
  if (status.kind !== 'legacy' && status.kind !== 'foreign') return [];
  const where = describePanIgnore(status);
  if (result.ignoreLinesRemoved.length > 0) {
    const lines = result.ignoreLinesRemoved.join(', ');
    return [`Removed Overdeck's legacy .pan/ ignore rule (${status.source} line ${lines}); committed with the artifacts.`];
  }
  if (status.kind === 'foreign') {
    return [
      `Warning: the plan home ignores .pan/ via ${where}, which is not Overdeck's legacy line.`,
      '  Artifacts under .pan/ cannot be committed until that rule is removed or narrowed; it was not edited.',
    ];
  }
  if (options.dryRun) {
    return [
      `The plan home ignores .pan/ via Overdeck's legacy rule ${where}.`,
      `  ${options.commit ? 'Without --dry-run, --commit' : '--commit'} removes that line and commits .gitignore with the artifacts.`,
    ];
  }
  return [
    `Warning: the plan home ignores .pan/ via Overdeck's legacy rule ${where};`
    + ' the copied artifacts are ignored by git and were not committed.',
    '  Fix: rerun with --repair-ignore (removes that line and commits .gitignore alone),',
    '  or rerun with --commit (also commits the migrated artifacts),',
    `  or delete line ${status.line} from ${status.source} and commit it yourself.`,
  ];
}

/**
 * `--repair-ignore`: remove Overdeck's legacy `.pan/` line from the plan
 * home's `.gitignore` and commit that file alone (PAN-3996). No artifacts are
 * copied and the tracker is never called.
 */
export async function runRepairPlanHomeIgnore(
  projectKey: string,
  options: Pick<MigratePlanHomeCliOptions, 'dryRun' | 'planHome' | 'stateRoot'>,
): Promise<number> {
  let planHome: string;
  try {
    ({ planHome } = resolveMigrationTargets({
      project: projectKey,
      stateRoot: options.stateRoot,
      planHome: options.planHome,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let result: Awaited<ReturnType<typeof repairLegacyPanIgnore>>;
  try {
    result = await repairLegacyPanIgnore(planHome, { dryRun: options.dryRun });
  } catch (error) {
    console.error(`migrate-plan-home: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const status = result.panIgnore;
  if (status.kind === 'not-a-repo') {
    console.error(`migrate-plan-home: ${planHome} is not inside a git work tree`);
    return 1;
  }
  if (status.kind === 'not-ignored') {
    console.log(`.pan/ is not ignored in ${planHome}; nothing to repair.`);
    return 0;
  }
  if (status.kind === 'foreign') {
    // Only reachable on --dry-run: a real run refuses before writing.
    console.log(`.pan/ is ignored by ${describePanIgnore(status)}, which is not Overdeck's legacy line;`
      + ' --repair-ignore will not edit it. Remove or narrow that rule yourself.');
    return 1;
  }
  if (options.dryRun) {
    console.log(`Would remove Overdeck's legacy .pan/ ignore rule ${describePanIgnore(status)} and commit .gitignore alone.`);
    return 0;
  }
  console.log(`Removed Overdeck's legacy .pan/ ignore rule (${status.source} line ${result.linesRemoved.join(', ')}).`);
  console.log(result.committed ? 'Committed .gitignore.' : 'Nothing to commit.');
  return 0;
}

export async function runMigratePlanHome(projectKey: string, options: MigratePlanHomeCliOptions): Promise<number> {
  // Before the tracker lookup: the repair must not depend on a working tracker.
  if (options.repairIgnore) {
    if (options.commit) {
      console.error('migrate-plan-home: --repair-ignore commits .gitignore alone; do not combine it with --commit');
      return 1;
    }
    return runRepairPlanHomeIgnore(projectKey, options);
  }

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

  let result: MigratePanHomeResult;
  try {
    result = await migratePanHome({
      stateRoot,
      planHome,
      openIssues,
      commit: options.commit,
      dryRun: options.dryRun,
      forceRemigrate: options.forceRemigrate,
    });
  } catch (error) {
    // PAN-3996: typed failures (MigratePlanHomeError, PlanHomeGitError) carry
    // an operator-facing message; nothing here prints a raw stack.
    console.error(`migrate-plan-home: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  for (const line of panIgnoreReport(result, options)) console.log(line);

  const verb = options.dryRun ? 'would copy' : 'copied';
  console.log(
    `${verb} ${result.copied.length}, unchanged ${result.unchanged}, `
    + `skipped ${result.skippedClosed} closed-issue file(s), ${result.remaining} remaining`,
  );
  console.log(`Progress copied for ${result.progressUpdated.length} issue(s).`);
  if (result.copied.length > 0) {
    for (const rel of result.copied) console.log(`  ${verb === 'copied' ? 'copied' : 'would copy'}: ${rel}`);
  }
  if (result.migrationComplete && options.dryRun && !options.forceRemigrate) {
    console.log(
      `Warning: the state worktree carries migration-complete.json`
      + `${result.migrationComplete.completedAt ? ` (${result.migrationComplete.completedAt})` : ''};`
      + ' a real run refuses without --force-remigrate.',
    );
  }
  if (result.conflicts.length > 0) {
    console.log(
      `${result.conflicts.length} file(s) already exist under .pan/ and differ from the state worktree copy;`
      + ' they were not overwritten. Compare them and keep the version you want by hand:',
    );
    for (const rel of result.conflicts) console.log(`  conflict: .pan/${rel}`);
  }
  if (result.leftUncommitted.length > 0) {
    console.log(
      `Left ${result.leftUncommitted.length} file(s) under .pan/ uncommitted: this run did not write them and they `
      + 'differ from the state worktree copy, so they are not migration output. Review and commit them yourself:',
    );
    for (const rel of result.leftUncommitted) console.log(`  left uncommitted: .pan/${rel}`);
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
    .option('--repair-ignore', "Only remove Overdeck's legacy .pan/ line from .gitignore and commit that file (no copy)")
    .option('--force-remigrate', 'Run even though the state worktree carries migration-complete.json')
    .option('--state-root <dir>', 'Override the state worktree root (tests / odd setups)')
    .option('--plan-home <dir>', 'Override the plan home (tests / odd setups)')
    .option('--open-issues <file>', 'Read open issue ids from a file instead of calling the tracker')
    .action(async (projectKey: string, options: MigratePlanHomeCliOptions) => {
      const code = await runMigratePlanHome(projectKey, options);
      if (code !== 0) return exitCli(code);
    });
}
