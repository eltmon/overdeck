import chalk from 'chalk';
import { Effect } from 'effect';
import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { extractPrefixSync } from '../../lib/issue-id.js';
import { getIssuePrefix } from '../../lib/projects.js';

interface WipeOptions {
  workspace?: boolean;
  yes?: boolean;
  force?: boolean;
}

export async function wipeCommand(issueId: string, options: WipeOptions): Promise<void> {
  console.log(chalk.yellow(`\n🔥 Reset issue to Todo for ${issueId}\n`));
  console.log(chalk.yellow('This touches workspace files, running processes, git branches, review state, beads, and tracker status.'));

  if (!options.yes && !options.force) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirmed = await new Promise<boolean>((resolve) => {
      rl.question(chalk.red(`This will destroy the workspace and reset ${issueId} to Todo. Continue? [y/N] `), (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });

    if (!confirmed) {
      console.log(chalk.gray('Aborted.'));
      return;
    }
  }

  const prefix = extractPrefixSync(issueId);
  if (!prefix) {
    console.log(chalk.red('  ✗ Could not extract prefix from issue ID'));
    return;
  }

  const projectsYamlPath = join(homedir(), '.panopticon', 'projects.yaml');
  let projectPath: string | undefined;
  if (existsSync(projectsYamlPath)) {
    try {
      const yaml = await import('js-yaml');
      const projectsConfig = yaml.load(readFileSync(projectsYamlPath, 'utf-8')) as any;
      for (const [, config] of Object.entries(projectsConfig.projects || {})) {
        const projConfig = config as any;
        if (getIssuePrefix(projConfig)?.toUpperCase() === prefix) {
          projectPath = projConfig.path;
          break;
        }
      }
    } catch {
      // Ignore YAML parse errors
    }
  }

  if (!projectPath) {
    console.log(chalk.red('  ✗ Could not resolve project path'));
    return;
  }

  const issueLower = issueId.toLowerCase();
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  const workspaceConfigPath = join(workspacePath, '.panopticon', 'workspace.json');

  let projectName = '';
  let githubMeta: { owner: string; repo: string; number: number } | undefined;
  if (existsSync(workspaceConfigPath)) {
    try {
      const workspaceConfig = JSON.parse(readFileSync(workspaceConfigPath, 'utf-8'));
      projectName = workspaceConfig.projectName || '';
      if (workspaceConfig.github?.owner && workspaceConfig.github?.repo && workspaceConfig.github?.number) {
        githubMeta = workspaceConfig.github;
      }
    } catch {
      // best effort
    }
  }

  const { resetToTodo } = await import('../../lib/lifecycle/index.js');
  const result = await Effect.runPromise(resetToTodo({
    issueId,
    projectPath,
    projectName,
    ...(githubMeta ? { github: githubMeta } : {}),
  }, {
    deleteWorkspace: options.workspace !== false,
    deleteBranches: options.workspace !== false,
    resetIssue: true,
  }));

  for (const step of result.steps) {
    if (step.details) {
      for (const detail of step.details) {
        console.log(step.success ? chalk.green(`  ✓ ${detail}`) : chalk.yellow(`  ⚠ ${detail}`));
      }
    }
    if (step.error) {
      console.log(chalk.yellow(`  ⚠ ${step.error}`));
    }
  }

  if (result.success) {
    console.log(chalk.green(`\n✓ Reset completed for ${issueId}`));
  } else {
    console.log(chalk.yellow(`\n⚠ Reset completed with errors for ${issueId}`));
  }
}
