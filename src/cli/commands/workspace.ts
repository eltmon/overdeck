import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, rmSync, readFileSync, symlinkSync } from 'fs';
import { join, basename } from 'path';
import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { mergeSkillsIntoWorkspaceSync, applyProjectTemplateOverlaySync } from '../../lib/skills-merge.js';
import { listRunningAgentsSync } from '../../lib/agents.js';
import {
  resolveProjectFromIssueSync,
  PROJECTS_CONFIG_FILE,
  findProjectByTeamSync,
  extractTeamPrefix,
  listProjectsSync,
  getProjectSync,
} from '../../lib/projects.js';
import {
  addReposToWorkspace,
  copyOverdeckSettingsToWorkspaceSync,
} from '../../lib/workspace-manager.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createCommand } from './workspace-create.js';
import { destroyCommand, listCommand } from './workspace-list.js';
import {
  migrateCommand,
  sshCommand,
  startCommand,
  stopCommand,
  syncAuthCommand,
} from './workspace-remote.js';

const execAsync = promisify(exec);
export { __testInternals } from './workspace-beads.js';
export { destroyCommand } from './workspace-list.js';

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program.command('workspace').description('Workspace management');

  workspace
    .command('create <issueId>')
    .description('Create workspace for issue')
    .option('--dry-run', 'Show what would be created')
    .option('--no-skills', 'Skip skills/agents installation')
    .option('--labels <labels>', 'Comma-separated labels for routing (e.g., docs,marketing)')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .option('--docker', 'Start Docker containers after workspace creation')
    .option('--remote', 'Create workspace on remote VM (Fly.io)')
    .option('--local', 'Create workspace locally (explicit override)')
    .action(createCommand);

  workspace
    .command('migrate <issueId>')
    .description('Migrate workspace between local and remote (stops+pauses the local agent, commits and pushes all work first)')
    .option('--to <location>', 'Target location: "remote" or "local" (default: auto-detect from current location)')
    .option('--keep', 'Keep the source workspace after migration')
    .option('--force', 'Overwrite an existing destination workspace / ignore branch-drift guard')
    .action(migrateCommand);

  workspace
    .command('ssh <issueId>')
    .description('SSH into remote workspace VM')
    .action(sshCommand);

  workspace
    .command('sync-auth <issueId>')
    .description('Sync Claude Code credentials to remote workspace')
    .action(syncAuthCommand);

  workspace
    .command('start <issueId>')
    .description('Start a stopped remote workspace')
    .action(startCommand);

  workspace
    .command('stop <issueId>')
    .description('Stop (hibernate) a remote workspace')
    .action(stopCommand);

  workspace
    .command('list')
    .description('List all workspaces')
    .option('--json', 'Output as JSON')
    .option('--all', 'List workspaces across all registered projects')
    .action(listCommand);

  workspace
    .command('destroy <issueId>')
    .description('Destroy workspace')
    .option('--force', 'Force removal even with uncommitted changes')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .action(destroyCommand);

  // Re-render `<workspace>/.devcontainer/` from the project's compose
  // template. Idempotent. The single source of truth for how the
  // devcontainer files look — used by project-specific bootstrap scripts
  // (e.g. MYN's `infra/new-feature`) instead of duplicating the render in
  // bash + `sed`. See MIN-848.
  workspace
    .command('render-devcontainer <featureName>')
    .description('Re-render <workspace>/.devcontainer/ from the project compose template')
    .option('--project <key>', 'Project key in projects.yaml (e.g. mind-your-now)')
    .option('--workspace <path>', 'Override the inferred workspace path')
    .option('--json', 'Emit JSON instead of human-readable output')
    .action(
      async (
        featureName: string,
        opts: { project?: string; workspace?: string; json?: boolean },
      ) => {
        const { workspaceRenderDevcontainerCommand } = await import(
          './workspace-render-devcontainer.js'
        );
        await workspaceRenderDevcontainerCommand(featureName, opts);
      },
    );

  // The ONLY allowed call site for `git clean -fd` against a workspace.
  // Refuses to run if stdin is not a TTY. Lists what would be deleted, asks
  // the user to type the issue ID to confirm, then runs the chokepointed
  // `runGitClean(..., userInvoked: true)`. See:
  //   src/lib/safety/dangerous-git-ops.ts
  //   src/cli/commands/workspace-deep-clean.ts
  workspace
    .command('deep-clean <issueId>')
    .description(
      'Interactive: git clean -fd against a workspace (preserves protected paths)',
    )
    .option('--yes', 'Skip confirmation prompt (still requires a TTY)')
    .action(async (issueId: string, opts: { yes?: boolean }) => {
      const { workspaceDeepCleanCommand } = await import('./workspace-deep-clean.js');
      await workspaceDeepCleanCommand(issueId, opts);
    });

  workspace
    .command('rebuild <issueId>')
    .description('Tear down, re-render, and restart a single workspace Docker stack')
    .action(async (issueId: string) => {
      const { workspaceRebuildCommand } = await import('./workspace-rebuild.js');
      await workspaceRebuildCommand(issueId);
    });

  workspace
    .command('reap')
    .description('List or remove orphaned unhealthy workspace Docker stacks')
    .option('--days <days>', 'Minimum age in days', '7')
    .option('--apply', 'Run docker compose down -v --remove-orphans for candidates')
    .option('--yes', 'Skip confirmation when using --apply')
    .action(async (opts: { days?: string; apply?: boolean; yes?: boolean }) => {
      const { workspaceReapCommand } = await import('./workspace-reap.js');
      await workspaceReapCommand(opts);
    });

  workspace
    .command('update <issueId>')
    .description('Update skills/agents/rules in an existing workspace')
    .option('--force', 'Overwrite user-modified files')
    .action(updateCommand);

  workspace
    .command('use-config <issueId>')
    .description('Copy installed Overdeck config into workspace (makes it user settings)')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .action(useConfigCommand);

  workspace
    .command('add-repo <workspaceId> <repoNames...>')
    .description('Add repositories to a progressive polyrepo workspace')
    .option('--dry-run', 'Show what would be added')
    .option('--group <groupName>', 'Add all repos from a named group (from groups_file)')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .action(addRepoCommand);
}

interface UseConfigOptions {
  project?: string;
}

async function useConfigCommand(issueId: string, options: UseConfigOptions): Promise<void> {
  const spinner = ora('Copying Overdeck config to workspace...').start();

  try {
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const folderName = `feature-${normalizedId}`;

    // Resolve workspace path
    let workspacePath: string;

    if (options.project) {
      const workspacesDir = join(options.project, 'workspaces');
      workspacePath = join(workspacesDir, folderName);
    } else {
      const teamPrefix = extractTeamPrefix(issueId);
      const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;

      if (projectConfig) {
        const workspacesDir = join(projectConfig.path, projectConfig.workspace?.workspaces_dir || 'workspaces');
        workspacePath = join(workspacesDir, folderName);
      } else {
        workspacePath = join(process.cwd(), 'workspaces', folderName);
      }
    }

    if (!existsSync(workspacePath)) {
      spinner.fail(`Workspace not found: ${workspacePath}`);
      process.exit(1);
    }

    spinner.text = 'Copying config...';
    const result = copyOverdeckSettingsToWorkspaceSync(workspacePath);

    if (result.errors.length > 0) {
      spinner.warn('Config copied with errors');
      for (const error of result.errors) {
        console.log(chalk.yellow(`  ⚠ ${error}`));
      }
    } else {
      spinner.succeed('Overdeck config copied to workspace');
    }

    if (result.copied.length > 0) {
      console.log(chalk.dim('  Copied:'));
      for (const file of result.copied) {
        console.log(chalk.dim(`    • ${file}`));
      }
    }

  } catch (error: any) {
    spinner.fail(`Failed to copy config: ${error.message}`);
    process.exit(1);
  }
}

interface UpdateOptions {
  force?: boolean;
}

async function updateCommand(issueId: string, options: UpdateOptions): Promise<void> {
  const spinner = ora('Updating workspace skills...').start();

  try {
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const folderName = `feature-${normalizedId}`;

    // Resolve project and workspace path
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;

    if (!projectConfig) {
      spinner.fail(`No project found for issue ${issueId}`);
      process.exit(1);
    }

    const workspaceConfig = projectConfig.workspace;
    const workspacesDir = join(projectConfig.path, workspaceConfig?.workspaces_dir || 'workspaces');
    const workspacePath = join(workspacesDir, folderName);

    if (!existsSync(workspacePath)) {
      spinner.fail(`Workspace not found: ${workspacePath}`);
      process.exit(1);
    }

    // Check if an agent is running in this workspace
    const runningAgents = listRunningAgentsSync();
    const agentInWorkspace = runningAgents.find(
      a => a.workspace === workspacePath && a.tmuxActive && a.status === 'running'
    );

    if (agentInWorkspace && !options.force) {
      spinner.fail(`Agent ${agentInWorkspace.id} is running in this workspace`);
      console.log(chalk.dim('  Use --force to update anyway, or stop the agent first.'));
      process.exit(1);
    }

    if (agentInWorkspace) {
      spinner.warn(`Agent ${agentInWorkspace.id} is running — updating anyway (--force)`);
    }

    // Merge skills, agents, and rules
    spinner.text = 'Merging skills and agents...';
    const result = mergeSkillsIntoWorkspaceSync(workspacePath);

    // Apply project template overlay if configured
    if (workspaceConfig?.agent?.template_dir && (workspaceConfig.agent.copy_dirs || workspaceConfig.agent.symlinks)) {
      spinner.text = 'Applying project template overlay...';
      const templateDir = join(projectConfig.path, workspaceConfig.agent.template_dir);
      const overlayed = applyProjectTemplateOverlaySync(workspacePath, templateDir);
      result.overlayed = overlayed;
    }

    const totalMerged = result.added.length + result.updated.length;
    spinner.succeed(`Updated workspace: ${totalMerged} files (${result.added.length} new, ${result.updated.length} updated)`);

    if (result.skipped.length > 0) {
      console.log(chalk.dim(`  Skipped: ${result.skipped.length} files`));
      for (const s of result.skipped.slice(0, 5)) {
        console.log(chalk.dim(`    - ${s}`));
      }
      if (result.skipped.length > 5) {
        console.log(chalk.dim(`    ... and ${result.skipped.length - 5} more`));
      }
    }

    if (result.overlayed.length > 0) {
      console.log(chalk.cyan(`  Overlayed: ${result.overlayed.length} project template files`));
    }

  } catch (error: any) {
    spinner.fail(`Failed to update workspace: ${error.message}`);
    process.exit(1);
  }
}

interface AddRepoOptions {
  dryRun?: boolean;
  group?: string;
  project?: string;
}

interface RepoGroups {
  groups: Record<string, string[] | '*'>;
}

/**
 * Load repo groups from the groups_file
 */
function loadRepoGroups(groupsFilePath: string): RepoGroups {
  const content = readFileSync(groupsFilePath, 'utf8');
  return YAML.parse(content) as RepoGroups;
}

/**
 * Add repositories to a progressive polyrepo workspace
 */
async function addRepoCommand(workspaceId: string, repoNames: string[], options: AddRepoOptions): Promise<void> {
  const spinner = ora('Adding repositories...').start();

  try {
    // Normalize workspace ID
    const normalizedId = workspaceId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const folderName = `feature-${normalizedId}`;

    // Resolve project
    let projectConfig: ReturnType<typeof findProjectByTeamSync> = null;
    if (options.project) {
      projectConfig = getProjectSync(options.project);
    }

    if (!projectConfig) {
      // Try to find project from workspace path
      const allProjects = listProjectsSync();
      for (const { config: p } of allProjects) {
        if (p.workspace?.workspaces_dir) {
          const workspacesDir = join(p.path, p.workspace.workspaces_dir);
          const workspacePath = join(workspacesDir, folderName);
          if (existsSync(workspacePath)) {
            projectConfig = p;
            break;
          }
        }
      }
    }

    if (!projectConfig) {
      spinner.fail(`No project found for workspace ${workspaceId}`);
      process.exit(1);
    }

    const workspaceConfig = projectConfig.workspace;
    if (!workspaceConfig || workspaceConfig.type !== 'polyrepo') {
      spinner.fail(`Project ${projectConfig.name} does not use polyrepo workspace`);
      process.exit(1);
    }

    if (!workspaceConfig.progressive) {
      spinner.warn('This workspace was not created with progressive mode — all repos already exist');
    }

    // Resolve repo names (expand groups if --group specified)
    let targetRepoNames = repoNames;

    if (options.group) {
      if (!workspaceConfig.groups_file) {
        spinner.fail('--group requires groups_file to be set in workspace config');
        process.exit(1);
      }

      const groupsFilePath = join(projectConfig.path, workspaceConfig.groups_file);
      if (!existsSync(groupsFilePath)) {
        spinner.fail(`Groups file not found: ${groupsFilePath}`);
        process.exit(1);
      }

      const groups = loadRepoGroups(groupsFilePath);

      if (options.group === 'all' || groups.groups[options.group] === '*') {
        targetRepoNames = workspaceConfig.repos!.map(r => r.name);
      } else if (Array.isArray(groups.groups[options.group])) {
        targetRepoNames = groups.groups[options.group] as string[];
      } else {
        spinner.fail(`Unknown group: ${options.group}`);
        process.exit(1);
      }
    }

    if (targetRepoNames.length === 0) {
      spinner.fail('No repos to add');
      process.exit(1);
    }

    // Add repos to workspace
    const result = await Effect.runPromise(addReposToWorkspace({
      projectConfig,
      featureName: normalizedId,
      repoNames: targetRepoNames,
      dryRun: options.dryRun,
    }));

    if (!result.success) {
      spinner.fail(`Failed to add repos: ${result.errors.join(', ')}`);
      for (const step of result.steps) {
        console.log(chalk.dim(`  ${step}`));
      }
      process.exit(1);
    }

    spinner.succeed(`Added ${targetRepoNames.length} repository(s) to workspace`);
    for (const step of result.steps) {
      if (!step.includes('Skipped')) {
        console.log(chalk.green(`  ${step}`));
      } else {
        console.log(chalk.dim(`  ${step}`));
      }
    }

  } catch (error: any) {
    spinner.fail(`Failed to add repos: ${error.message}`);
    process.exit(1);
  }
}

// YAML parser - using simple regex-based parsing for repo-groups.yaml
const YAML = {
  parse(content: string): any {
    const result: any = { groups: {} };
    let currentSection = null;
    let currentIndent = 0;

    for (const line of content.split('\n')) {
      // Skip empty lines and comments
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const indent = line.search(/\S/);
      const trimmed = line.trim();

      if (trimmed.startsWith('groups:')) {
        currentSection = 'groups';
        continue;
      }

      if (currentSection === 'groups') {
        const match = trimmed.match(/^(\w+):\s*(.*)$/);
        if (match) {
          const [, key, value] = match;
          if (value.trim() === '' || value.trim() === '*') {
            result.groups[key] = value.trim() === '*' ? '*' : [];
          } else {
            // Inline array
            result.groups[key] = value.replace(/[\[\]]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        }
      }
    }

    return result;
  }
};
