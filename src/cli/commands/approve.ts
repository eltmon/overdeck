import chalk from 'chalk';
import ora from 'ora';
import { getAgentState, saveAgentState } from '../../lib/agents.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { AGENTS_DIR } from '../../lib/paths.js';
import { shouldSkipTrackerUpdate } from '../../lib/shadow-mode.js';
import { markAsSynced } from '../../lib/shadow-state.js';
import { getLinearApiKey } from '../../lib/shadow-utils.js';

export function checkGhCli(): boolean {
  try {
    execSync('which gh', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function findPRForBranch(workspace: string): { number: number; url: string } | null {
  try {
    // Get current branch
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workspace,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Find PR for this branch
    const prJson = execSync(`gh pr list --head "${branch}" --json number,url --limit 1`, {
      cwd: workspace,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const prs = JSON.parse(prJson);
    if (prs.length > 0) {
      return { number: prs[0].number, url: prs[0].url };
    }
    return null;
  } catch {
    return null;
  }
}

export function mergePR(workspace: string, prNumber: number): { success: boolean; error?: string } {
  try {
    // NOTE: Do NOT use --delete-branch - feature branches should be preserved for history
    execSync(`gh pr merge ${prNumber} --squash`, {
      cwd: workspace,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateLinearStatus(apiKey: string, issueIdentifier: string): Promise<boolean> {
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    // Deterministic lookup by identifier — no team iteration needed
    // searchIssues returns IssueSearchResult which lacks .update(); re-fetch full Issue object
    const searchResults = await client.searchIssues(issueIdentifier, { first: 1 });
    const searchHit = searchResults.nodes.find(
      (i) => i.identifier.toUpperCase() === issueIdentifier.toUpperCase()
    );

    if (!searchHit) return false;
    const issue = await client.issue(searchHit.id);

    // Get the team from the issue itself, then find the Done state
    const team = await issue.team;
    if (!team) return false;

    const states = await team.states();
    const doneState = states.nodes.find((s) => s.type === 'completed' && s.name === 'Done');

    if (!doneState) return false;

    // Update issue
    await issue.update({ stateId: doneState.id });
    return true;
  } catch {
    return false;
  }
}

export async function approveCommand(id: string): Promise<void> {
  const agentId = id.startsWith('agent-') ? id : `agent-${id.toLowerCase()}`;

  // Agent guard: pan approve is a supervisor-only command.
  // Agents must use `pan done` to signal completion — approval is for humans only.
  // This guard uses process.exit(1) rather than return so the agent sees a clear failure.
  const callingAgentId = process.env.PANOPTICON_AGENT_ID;
  if (callingAgentId) {
    console.error(chalk.red('ERROR: pan approve is a supervisor-only command.'));
    console.error(chalk.red(`Agents MUST use: pan done <issue-id> -c "summary"`));
    console.error(chalk.dim(`You are running as agent: ${callingAgentId}`));
    process.exit(1);
  }

  const state = getAgentState(agentId);

  if (!state) {
    console.log(chalk.yellow(`Agent ${agentId} not found.`));
    console.log(chalk.dim('Run "pan status" to see running agents.'));
    return;
  }

  const spinner = ora('Approving work...').start();

  try {
    const workspace = state.workspace;
    let prMerged = false;
    let linearUpdated = false;

    // Step 1: Find and merge PR
    if (!checkGhCli()) {
      spinner.warn('gh CLI not found - skipping PR merge');
      console.log(chalk.dim('  Install: https://cli.github.com/'));
    } else {
      spinner.text = 'Looking for PR...';
      const pr = findPRForBranch(workspace);

      if (pr) {
        spinner.text = `Merging PR #${pr.number}...`;
        const result = mergePR(workspace, pr.number);

        if (result.success) {
          prMerged = true;
          console.log(chalk.green(`  ✓ Merged PR #${pr.number}`));
        } else {
          console.log(chalk.yellow(`  ⚠ Failed to merge: ${result.error}`));
          console.log(chalk.dim(`    Merge manually: gh pr merge ${pr.number} --squash`));
        }
      } else {
        console.log(chalk.dim('  No PR found for this branch'));
      }
    }

    // Step 2: Update status (either tracker or shadow)
    const skipTrackerUpdate = await shouldSkipTrackerUpdate(state.issueId);

    if (skipTrackerUpdate) {
      spinner.text = 'Marking shadow state as synced...';
      const syncResult = await markAsSynced(state.issueId, 'closed');
      if (syncResult.success) {
        console.log(chalk.cyan(`  👻 Shadow mode: marked as synced`));
      } else {
        console.log(chalk.yellow(`  ⚠ Failed to update shadow state: ${syncResult.error}`));
      }
    } else {
      const apiKey = getLinearApiKey();
      if (apiKey) {
        spinner.text = 'Updating Linear status...';
        linearUpdated = await updateLinearStatus(apiKey, state.issueId);
        if (linearUpdated) {
          console.log(chalk.green(`  ✓ Updated ${state.issueId} to Done`));
        } else {
          console.log(chalk.yellow(`  ⚠ Failed to update Linear status`));
        }
      } else {
        console.log(chalk.dim('  LINEAR_API_KEY not set - skipping status update'));
      }
    }

    // Step 3: Update agent state
    state.status = 'stopped';
    state.lastActivity = new Date().toISOString();
    saveAgentState(state);

    // Mark as approved
    const approvedFile = join(AGENTS_DIR, agentId, 'approved');
    writeFileSync(approvedFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      prMerged,
      linearUpdated,
    }));

    spinner.succeed(`Approved: ${state.issueId}`);
    console.log('');

    // Summary
    console.log(chalk.bold('Summary:'));
    console.log(`  Issue:   ${chalk.cyan(state.issueId)}`);
    console.log(`  PR:      ${prMerged ? chalk.green('Merged') : chalk.dim('Not merged')}`);
    if (skipTrackerUpdate) {
      console.log(`  Status:  ${chalk.cyan('👻 Shadow mode - marked as synced')}`);
    } else {
      console.log(`  Linear:  ${linearUpdated ? chalk.green('Updated to Done') : chalk.dim('Not updated')}`);
    }
    console.log('');

    console.log(chalk.dim('Workspace can be cleaned up with:'));
    console.log(chalk.dim(`  pan workspace destroy ${state.issueId}`));

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}
