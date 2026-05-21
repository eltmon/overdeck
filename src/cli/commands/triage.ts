/**
 * work triage - Triage issues from secondary tracker to primary tracker
 *
 * Uses the tracker abstraction to move issues between trackers.
 */

import chalk from 'chalk';
import { Effect } from 'effect';
import ora from 'ora';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig } from '../../lib/config.js';
import type { Issue, TrackerType } from '../../lib/tracker/index.js';
import { createTracker, TrackerConfig } from '../../lib/tracker/index.js';

interface TriageOptions {
  create?: boolean;
  dismiss?: string;
}

interface TriageState {
  dismissed: string[];  // Issue refs that were dismissed
  created: { [sourceRef: string]: string };  // Source ref -> Primary ref
}

/**
 * Get tracker config by type from panopticon config
 */
function getTrackerConfig(trackerType: TrackerType): TrackerConfig | null {
  const config = loadConfig();
  const trackerConfig = config.trackers[trackerType];

  if (!trackerConfig) {
    return null;
  }

  return {
    type: trackerType,
    apiKeyEnv: (trackerConfig as any).api_key_env,
    team: (trackerConfig as any).team,
    tokenEnv: (trackerConfig as any).token_env,
    owner: (trackerConfig as any).owner,
    repo: (trackerConfig as any).repo,
    projectId: (trackerConfig as any).project_id,
  };
}

function getTriageStatePath(): string {
  return join(homedir(), '.panopticon', 'triage-state.json');
}

function loadTriageState(): TriageState {
  const path = getTriageStatePath();
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return { dismissed: [], created: {} };
    }
  }
  return { dismissed: [], created: {} };
}

function saveTriageState(state: TriageState): void {
  const dir = join(homedir(), '.panopticon');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = getTriageStatePath();
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export async function triageCommand(id?: string, options: TriageOptions = {}): Promise<void> {
  const spinner = ora('Loading triage queue...').start();

  try {
    const config = loadConfig();
    const primaryType = config.trackers.primary;
    const secondaryType = config.trackers.secondary;

    // Check for secondary tracker configuration
    if (!secondaryType) {
      spinner.info('No secondary tracker configured');
      console.log('');
      console.log(chalk.bold('Setup Instructions:'));
      console.log('');
      console.log('Add secondary tracker to ~/.panopticon/config.toml:');
      console.log(chalk.dim(`
[trackers]
primary = "linear"
secondary = "github"

[trackers.github]
type = "github"
token_env = "GITHUB_TOKEN"
owner = "your-org"
repo = "your-repo"
`));
      return;
    }

    const primaryConfig = getTrackerConfig(primaryType);
    const secondaryConfig = getTrackerConfig(secondaryType);

    if (!primaryConfig) {
      spinner.fail(`Primary tracker (${primaryType}) not configured`);
      return;
    }

    if (!secondaryConfig) {
      spinner.fail(`Secondary tracker (${secondaryType}) not configured`);
      return;
    }

    const triageState = loadTriageState();

    // If specific ID provided, handle create/dismiss
    if (id) {
      // Normalize the ID (remove # prefix if present for GitHub)
      const issueRef = id.startsWith('#') ? id : `#${id}`;

      if (options.dismiss) {
        if (!triageState.dismissed.includes(issueRef)) {
          triageState.dismissed.push(issueRef);
          saveTriageState(triageState);
        }
        spinner.succeed(`Dismissed ${issueRef}: ${options.dismiss}`);
        return;
      }

      if (options.create) {
        spinner.text = `Fetching ${secondaryType} issue ${issueRef}...`;

        let secondaryTracker;
        try {
          secondaryTracker = createTracker(secondaryConfig);
        } catch (error: any) {
          spinner.fail(`Failed to connect to ${secondaryType}: ${error.message}`);
          return;
        }

        let sourceIssue: Issue;
        try {
          sourceIssue = await Effect.runPromise(secondaryTracker.getIssue(id));
        } catch (error: any) {
          spinner.fail(`Issue ${issueRef} not found in ${secondaryType}`);
          return;
        }

        spinner.text = `Creating ${primaryType} issue...`;

        let primaryTracker;
        try {
          primaryTracker = createTracker(primaryConfig);
        } catch (error: any) {
          spinner.fail(`Failed to connect to ${primaryType}: ${error.message}`);
          return;
        }

        // Create issue in primary tracker with link to secondary
        const newIssue = await Effect.runPromise(primaryTracker.createIssue({
          title: sourceIssue.title,
          description: `${sourceIssue.description}\n\n---\n\n**From ${secondaryType}:** ${sourceIssue.url}`,
          team: primaryConfig.team,
        }));

        // Add comment to secondary issue linking to primary
        try {
          await Effect.runPromise(secondaryTracker.addComment(
            id,
            `Internal tracking: ${newIssue.ref} (${primaryType})`
          ));
        } catch {
          // Non-fatal - just log warning
          console.log(chalk.yellow('\nNote: Could not add link comment to source issue'));
        }

        triageState.created[sourceIssue.ref] = newIssue.ref;
        saveTriageState(triageState);

        spinner.succeed(`Created ${newIssue.ref} from ${sourceIssue.ref}`);
        console.log('');
        console.log(`  ${secondaryType}: ${chalk.dim(sourceIssue.url)}`);
        console.log(`  ${primaryType}: ${chalk.cyan(newIssue.ref)}`);
        return;
      }
    }

    // List all secondary tracker issues needing triage
    spinner.text = `Fetching ${secondaryType} issues...`;

    let secondaryTracker;
    try {
      secondaryTracker = createTracker(secondaryConfig);
    } catch (error: any) {
      spinner.fail(`Failed to connect to ${secondaryType}: ${error.message}`);
      return;
    }

    const issues = await Effect.runPromise(secondaryTracker.listIssues({ includeClosed: false }));

    // Filter out dismissed and already created
    const pending = issues.filter(
      (i) => !triageState.dismissed.includes(i.ref) && !triageState.created[i.ref]
    );

    spinner.stop();

    if (pending.length === 0) {
      console.log(chalk.green('No issues pending triage.'));
      console.log(chalk.dim(`${issues.length} total open, ${triageState.dismissed.length} dismissed, ${Object.keys(triageState.created).length} created`));
      return;
    }

    console.log(chalk.bold(`\n${secondaryType.toUpperCase()} Issues Pending Triage (${pending.length})\n`));

    for (const issue of pending) {
      const labels = issue.labels.map((l) => chalk.dim(`[${l}]`)).join(' ');
      console.log(`  ${chalk.cyan(issue.ref)} ${issue.title} ${labels}`);
      console.log(`    ${chalk.dim(issue.url)}`);
    }

    console.log('');
    console.log(chalk.bold('Commands:'));
    console.log(`  ${chalk.dim(`Create ${primaryType} issue:`)} pan issues <id> --create`);
    console.log(`  ${chalk.dim('Dismiss from queue:')}  pan issues <id> --dismiss "reason"`);
    console.log('');

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}
