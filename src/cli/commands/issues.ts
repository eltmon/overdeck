/**
 * work list - List issues from configured trackers
 *
 * Uses the tracker abstraction to support Linear, GitHub, and GitLab.
 */

import chalk from 'chalk';
import { Effect } from 'effect';
import ora from 'ora';
import { Effect } from 'effect';
import { loadConfig } from '../../lib/config.js';
import type { Issue, IssueTracker, TrackerType } from '../../lib/tracker/index.js';
import { createTracker, TrackerConfig } from '../../lib/tracker/index.js';
import { isShadowed, getPendingSyncCount } from '../../lib/shadow-state.js';
import { loadProjectsConfig } from '../../lib/projects.js';

interface ListOptions {
  all?: boolean;
  mine?: boolean;
  json?: boolean;
  tracker?: string;
  allTrackers?: boolean;
  shadowOnly?: boolean;
}

const PRIORITY_LABELS: Record<number, string> = {
  0: chalk.dim('None'),
  1: chalk.red('Urgent'),
  2: chalk.yellow('High'),
  3: chalk.blue('Medium'),
  4: chalk.dim('Low'),
};

const STATE_COLORS: Record<string, (s: string) => string> = {
  'open': chalk.white,
  'in_progress': chalk.yellow,
  'closed': chalk.green,
};

/**
 * Get tracker config by type from panopticon config
 */
function getTrackerConfig(trackerType: TrackerType): TrackerConfig | null {
  const config = loadConfig();
  const trackerConfig = config.trackers[trackerType];

  if (trackerConfig) {
    return {
      type: trackerType,
      apiKeyEnv: (trackerConfig as any).api_key_env,
      team: (trackerConfig as any).team,
      tokenEnv: (trackerConfig as any).token_env,
      owner: (trackerConfig as any).owner,
      repo: (trackerConfig as any).repo,
      projectId: (trackerConfig as any).project_id,
      server: (trackerConfig as any).server,
      workspace: (trackerConfig as any).workspace,
      project: (trackerConfig as any).project,
    };
  }

  // Auto-derive from projects.yaml for GitHub/GitLab
  if (trackerType === 'github') {
    try {
      const { projects } = loadProjectsConfig();
      for (const [, project] of Object.entries(projects)) {
        if (project.github_repo) {
          const [owner, repo] = project.github_repo.split('/');
          if (owner && repo) {
            return {
              type: 'github',
              tokenEnv: 'GITHUB_TOKEN',
              owner,
              repo,
            };
          }
        }
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Get all configured trackers
 */
function getConfiguredTrackers(): TrackerType[] {
  const config = loadConfig();
  const trackers: TrackerType[] = [];

  if (config.trackers.linear) trackers.push('linear');
  if (config.trackers.github) trackers.push('github');
  if (config.trackers.gitlab) trackers.push('gitlab');
  if (config.trackers.rally) trackers.push('rally');

  // Auto-detect from projects.yaml if not explicitly configured
  if (!trackers.includes('github') || !trackers.includes('gitlab')) {
    try {
      const { projects } = loadProjectsConfig();
      for (const [, project] of Object.entries(projects)) {
        if (project.github_repo && !trackers.includes('github')) trackers.push('github');
        if (project.gitlab_repo && !trackers.includes('gitlab')) trackers.push('gitlab');
      }
    } catch { /* ignore */ }
  }

  return trackers;
}

/**
 * Display issues in a formatted way
 */
async function displayIssues(issues: Issue[], trackerName: string): Promise<void> {
  if (issues.length === 0) {
    console.log(chalk.dim(`  No issues found in ${trackerName}`));
    return;
  }

  // Pre-compute shadowed refs in one batch so the render loop stays sync.
  const shadowedRefs = new Set<string>();
  const shadowChecks = await Promise.all(issues.map(async i => [i.ref, await isShadowed(i.ref)] as const));
  for (const [ref, shadowed] of shadowChecks) if (shadowed) shadowedRefs.add(ref);

  // Group by state
  const byState: Record<string, Issue[]> = {};
  for (const issue of issues) {
    if (!byState[issue.state]) byState[issue.state] = [];
    byState[issue.state].push(issue);
  }

  // Display order
  const stateOrder = ['in_progress', 'open', 'closed'];

  for (const state of stateOrder) {
    const stateIssues = byState[state];
    if (!stateIssues || stateIssues.length === 0) continue;

    const colorFn = STATE_COLORS[state] || chalk.white;
    const displayState = state.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    console.log(colorFn(`  ── ${displayState} (${stateIssues.length}) ──`));

    for (const issue of stateIssues) {
      const priorityLabel = issue.priority ? PRIORITY_LABELS[issue.priority] || '' : '';
      const assigneeStr = issue.assignee ? chalk.dim(` @${issue.assignee.split(' ')[0]}`) : '';
      const priorityStr = issue.priority && issue.priority < 3 ? ` ${priorityLabel}` : '';
      const shadowIndicator = shadowedRefs.has(issue.ref) ? chalk.cyan('👻 ') : '';

      console.log(`    ${shadowIndicator}${chalk.cyan(issue.ref)} ${issue.title}${assigneeStr}${priorityStr}`);
    }
    console.log('');
  }
}

export async function listCommand(options: ListOptions): Promise<void> {
  const spinner = ora('Fetching issues...').start();

  try {
    const config = loadConfig();
    const trackersToQuery: TrackerType[] = [];

    // Determine which trackers to query
    if (options.tracker) {
      // Specific tracker requested
      const trackerType = options.tracker as TrackerType;
      if (!['linear', 'github', 'gitlab', 'rally'].includes(trackerType)) {
        spinner.fail(`Unknown tracker: ${options.tracker}`);
        console.log(chalk.dim('Valid trackers: linear, github, gitlab, rally'));
        process.exit(1);
      }
      trackersToQuery.push(trackerType);
    } else if (options.allTrackers) {
      // All configured trackers
      trackersToQuery.push(...getConfiguredTrackers());
    } else {
      // Primary tracker only (default)
      trackersToQuery.push(config.trackers.primary);
    }

    if (trackersToQuery.length === 0) {
      spinner.fail('No trackers configured');
      console.log(chalk.dim('Configure trackers in ~/.panopticon/config.toml'));
      process.exit(1);
    }

    // Fetch issues from all requested trackers
    const allIssues: { tracker: TrackerType; issues: Issue[] }[] = [];

    for (const trackerType of trackersToQuery) {
      spinner.text = `Fetching from ${trackerType}...`;

      const trackerConfig = getTrackerConfig(trackerType);
      if (!trackerConfig) {
        console.log(chalk.yellow(`\nWarning: ${trackerType} not configured, skipping`));
        continue;
      }

      try {
        const tracker = createTracker(trackerConfig);
        const issues = await Effect.runPromise(tracker.listIssues({
          includeClosed: options.all,
          assignee: options.mine ? 'me' : undefined,
        }));
        allIssues.push({ tracker: trackerType, issues });
      } catch (error: any) {
        console.log(chalk.yellow(`\nWarning: Failed to fetch from ${trackerType}: ${error.message}`));
      }
    }

    spinner.stop();

    // JSON output
    if (options.json) {
      const output = allIssues.flatMap(({ tracker, issues }) =>
        issues.map(issue => ({ ...issue, source: tracker }))
      );
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Display results
    const totalIssues = allIssues.reduce((sum, { issues }) => sum + issues.length, 0);

    if (totalIssues === 0) {
      console.log(chalk.dim('\nNo issues found.'));
      return;
    }

    if (options.shadowOnly) {
      // Render only the shadow-only subset — the full list is suppressed.
      const filteredIssues = await Promise.all(
        allIssues.map(async ({ tracker, issues }) => {
          const shadowChecks = await Promise.all(issues.map(i => isShadowed(i.ref)));
          return { tracker, issues: issues.filter((_, idx) => shadowChecks[idx]) };
        })
      );
      const nonEmpty = filteredIssues.filter(({ issues }) => issues.length > 0);

      if (nonEmpty.length === 0) {
        console.log(chalk.dim('\nNo shadowed issues found.'));
      } else {
        for (const { tracker, issues } of nonEmpty) {
          console.log(chalk.bold(`\n${tracker.toUpperCase()} (${issues.length} shadowed issues)\n`));
          await displayIssues(issues, tracker);
        }
      }
    } else {
      for (const { tracker, issues } of allIssues) {
        console.log(chalk.bold(`\n${tracker.toUpperCase()} (${issues.length} issues)\n`));
        await displayIssues(issues, tracker);
      }
    }

    // Footer
    const trackerNames = trackersToQuery.join(', ');
    console.log(chalk.dim(`Showing ${totalIssues} issues from ${trackerNames}.`));
    if (!options.all) {
      console.log(chalk.dim('Use --all to include closed issues.'));
    }
    if (!options.allTrackers && trackersToQuery.length === 1) {
      console.log(chalk.dim('Use --all-trackers to query all configured trackers.'));
    }

    // Show shadow mode info
    const pendingSync = await getPendingSyncCount();
    if (pendingSync > 0) {
      console.log(chalk.cyan(`👻 ${pendingSync} shadowed issue(s) pending sync`));
    }

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}
