import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { createWorktree, removeWorktree, listWorktrees } from '../../lib/worktree.js';
import { generateClaudeMd, TemplateVariables } from '../../lib/template.js';
import { mergeSkillsIntoWorkspace } from '../../lib/skills-merge.js';
import {
  resolveProjectFromIssue,
  hasProjects,
  PROJECTS_CONFIG_FILE,
  findProjectByTeam,
  extractTeamPrefix,
  listProjects,
} from '../../lib/projects.js';
import {
  createWorkspace as createWorkspaceFromConfig,
  removeWorkspace as removeWorkspaceFromConfig,
} from '../../lib/workspace-manager.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Initialize fresh beads for a workspace, removing any inherited beads from main branch
 */
async function initializeWorkspaceBeads(workspacePath: string, issueId: string): Promise<{ success: boolean; beadId?: string; error?: string }> {
  try {
    // Remove inherited .beads directory if it exists (copied from main via worktree)
    const beadsDir = join(workspacePath, '.beads');
    if (existsSync(beadsDir)) {
      rmSync(beadsDir, { recursive: true, force: true });
    }

    // Initialize fresh beads
    const prefix = 'workspace';
    await execAsync(`bd init --prefix ${prefix}`, { cwd: workspacePath, encoding: 'utf-8' });

    // Create a bead for this specific issue
    const title = `${issueId.toUpperCase()}: Implementation`;
    const { stdout } = await execAsync(
      `bd create --title "${title}" --priority 1 --type task --json`,
      { cwd: workspacePath, encoding: 'utf-8' }
    );

    // Parse the created bead ID
    try {
      const result = JSON.parse(stdout);
      return { success: true, beadId: result.id };
    } catch {
      // bd create might not output JSON, try to extract ID from output
      const match = stdout.match(/([a-z]+-[a-z0-9]+)/);
      return { success: true, beadId: match?.[1] };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program.command('workspace').description('Workspace management');

  workspace
    .command('create <issueId>')
    .description('Create workspace for issue')
    .option('--dry-run', 'Show what would be created')
    .option('--no-skills', 'Skip skills symlink setup')
    .option('--labels <labels>', 'Comma-separated labels for routing (e.g., docs,marketing)')
    .option('--project <path>', 'Explicit project path (overrides registry)')
    .option('--docker', 'Start Docker containers after workspace creation')
    .action(createCommand);

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
}

interface CreateOptions {
  dryRun?: boolean;
  skills?: boolean;
  labels?: string;
  project?: string;
  docker?: boolean;
}

async function createCommand(issueId: string, options: CreateOptions): Promise<void> {
  const spinner = ora('Creating workspace...').start();

  try {
    // Normalize issue ID (e.g., MIN-123 -> min-123)
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const branchName = `feature/${normalizedId}`;
    const folderName = `feature-${normalizedId}`;

    // Parse labels if provided
    const labels = options.labels
      ? options.labels.split(',').map((l) => l.trim())
      : [];

    // Try to find project config from registry
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

    // Priority 1: Use workspace-manager if project has workspace config
    if (projectConfig?.workspace) {
      spinner.text = 'Creating workspace from config...';

      const result = await createWorkspaceFromConfig({
        projectConfig,
        featureName: normalizedId,
        startDocker: options.docker,
        dryRun: options.dryRun,
      });

      if (options.dryRun) {
        spinner.info('Dry run - no changes made');
        console.log('');
        for (const step of result.steps) {
          console.log(chalk.dim(`  ${step}`));
        }
        return;
      }

      if (result.success) {
        spinner.succeed('Workspace created!');
        console.log('');
        console.log(chalk.bold('Workspace Details:'));
        console.log(`  Project: ${chalk.green(projectConfig.name)}`);
        console.log(`  Path:    ${chalk.cyan(result.workspacePath)}`);
        console.log(`  Branch:  ${chalk.dim(branchName)}`);
        console.log('');

        // Show steps
        console.log(chalk.bold('Completed Steps:'));
        for (const step of result.steps) {
          console.log(`  ${chalk.green('✓')} ${step}`);
        }

        // Show services if configured
        if (projectConfig.workspace.services && projectConfig.workspace.services.length > 0) {
          console.log('');
          console.log(chalk.bold('To start services:'));
          const composeProject = `${basename(projectConfig.path)}-${folderName}`;
          for (const service of projectConfig.workspace.services) {
            const containerName = `${composeProject}-${service.name}-1`;
            const cmd = service.docker_command || service.start_command;
            console.log(`  ${chalk.cyan(service.name)}: docker exec -it ${containerName} ${cmd}`);
          }
        }

        // Show URLs if DNS configured
        if (projectConfig.workspace.dns) {
          console.log('');
          console.log(chalk.bold('URLs:'));
          for (const entry of projectConfig.workspace.dns.entries) {
            const url = entry
              .replace('{{FEATURE_FOLDER}}', folderName)
              .replace('{{DOMAIN}}', projectConfig.workspace.dns.domain);
            console.log(`  https://${url}`);
          }
        }

        if (result.errors.length > 0) {
          console.log('');
          console.log(chalk.yellow('Warnings:'));
          for (const error of result.errors) {
            console.log(`  ${chalk.yellow('⚠')} ${error}`);
          }
        }
      } else {
        spinner.fail('Workspace creation failed');
        for (const error of result.errors) {
          console.error(chalk.red(`  ${error}`));
        }
        process.exit(1);
      }
      return;
    }

    // Priority 2: Use custom workspace_command (legacy)
    if (projectConfig?.workspace_command) {
      spinner.text = 'Running custom workspace command...';

      const dockerFlag = options.docker ? ' --docker' : '';
      const cmd = `${projectConfig.workspace_command} ${normalizedId}${dockerFlag}`;
      try {
        const { stdout } = await execAsync(cmd, {
          cwd: projectConfig.path,
          encoding: 'utf-8',
          timeout: options.docker ? 300000 : 120000,
        });

        if (stdout) {
          console.log(stdout);
        }

        spinner.succeed('Workspace created via custom command!');
        return;
      } catch (error: any) {
        spinner.fail(`Custom workspace command failed: ${error.message}`);
        if (error.stderr) {
          console.error(error.stderr);
        }
        process.exit(1);
      }
    }

    // Priority 3: Simple git worktree creation (no config)
    // Resolve project root
    let projectRoot: string;
    let projectName: string | undefined;

    if (options.project) {
      projectRoot = options.project;
    } else {
      const resolved = resolveProjectFromIssue(issueId, labels);
      if (resolved) {
        projectRoot = resolved.projectPath;
        projectName = resolved.projectName;
        spinner.text = `Resolved project: ${projectName} (${projectRoot})`;
      } else if (hasProjects()) {
        spinner.warn(`No project found for ${issueId} in registry. Using current directory.`);
        spinner.start('Creating workspace...');
        projectRoot = process.cwd();
      } else {
        projectRoot = process.cwd();
      }
    }

    const workspacesDir = join(projectRoot, 'workspaces');
    const workspacePath = join(workspacesDir, folderName);

    if (options.dryRun) {
      spinner.info('Dry run mode');
      console.log('');
      console.log(chalk.bold('Would create:'));
      if (projectName) {
        console.log(`  Project:   ${chalk.green(projectName)}`);
      }
      console.log(`  Root:      ${chalk.dim(projectRoot)}`);
      console.log(`  Workspace: ${chalk.cyan(workspacePath)}`);
      console.log(`  Branch:    ${chalk.cyan(branchName)}`);
      return;
    }

    if (existsSync(workspacePath)) {
      spinner.fail(`Workspace already exists: ${workspacePath}`);
      process.exit(1);
    }

    if (!existsSync(join(projectRoot, '.git'))) {
      spinner.fail('Not a git repository. Run this from the project root.');
      process.exit(1);
    }

    // Create worktree
    spinner.text = 'Creating git worktree...';
    createWorktree(projectRoot, workspacePath, branchName);

    // Initialize fresh beads for this workspace (remove inherited beads from main)
    spinner.text = 'Initializing workspace beads...';
    const beadsResult = await initializeWorkspaceBeads(workspacePath, issueId);
    let workspaceBeadId: string | undefined;
    if (beadsResult.success) {
      workspaceBeadId = beadsResult.beadId;
    }

    // Generate CLAUDE.md
    spinner.text = 'Generating CLAUDE.md...';
    const variables: TemplateVariables = {
      FEATURE_FOLDER: folderName,
      BRANCH_NAME: branchName,
      ISSUE_ID: issueId.toUpperCase(),
      WORKSPACE_PATH: workspacePath,
      FRONTEND_URL: `https://${folderName}.localhost:3000`,
      API_URL: `https://api-${folderName}.localhost:8080`,
      PROJECT_NAME: projectName,
      BEAD_ID: workspaceBeadId,
    };

    const claudeMd = generateClaudeMd(projectRoot, variables);
    writeFileSync(join(workspacePath, 'CLAUDE.md'), claudeMd);

    // Merge skills (unless disabled)
    let skillsResult = { added: [] as string[], skipped: [] as string[] };
    if (options.skills !== false) {
      spinner.text = 'Merging skills...';
      mkdirSync(join(workspacePath, '.claude', 'skills'), { recursive: true });
      skillsResult = mergeSkillsIntoWorkspace(workspacePath);
    }

    // Start Docker containers if requested
    let dockerStarted = false;
    let dockerError: string | undefined;
    if (options.docker) {
      const composeLocations = [
        join(workspacePath, 'docker-compose.yml'),
        join(workspacePath, 'docker-compose.yaml'),
        join(workspacePath, '.devcontainer', 'docker-compose.yml'),
        join(workspacePath, '.devcontainer', 'docker-compose.yaml'),
        join(workspacePath, '.devcontainer', 'docker-compose.devcontainer.yml'),
        join(workspacePath, '.devcontainer', 'compose.yml'),
        join(workspacePath, '.devcontainer', 'compose.yaml'),
      ];

      const composeFile = composeLocations.find(f => existsSync(f));

      if (composeFile) {
        spinner.text = 'Starting Docker containers...';
        try {
          const composeDir = join(composeFile, '..');
          // Construct project name from project name and feature folder
          const projectPrefix = (projectName || 'workspace').toLowerCase().replace(/\s+/g, '-');
          const composeProject = `${projectPrefix}-${folderName}`;
          // Use -p for project name (unique container names) and -f for compose file
          await execAsync(`docker compose -p "${composeProject}" -f "${composeFile}" up -d --build`, {
            cwd: composeDir,
            encoding: 'utf-8',
            timeout: 300000,
          });
          dockerStarted = true;
        } catch (err: any) {
          dockerError = err.message;
        }
      } else {
        dockerError = 'No docker-compose.yml found in workspace';
      }
    }

    spinner.succeed('Workspace created!');

    console.log('');
    console.log(chalk.bold('Workspace Details:'));
    if (projectName) {
      console.log(`  Project: ${chalk.green(projectName)}`);
    }
    console.log(`  Path:   ${chalk.cyan(workspacePath)}`);
    console.log(`  Branch: ${chalk.dim(branchName)}`);
    console.log('');

    if (options.skills !== false) {
      console.log(chalk.bold('Skills:'));
      console.log(`  Added:   ${skillsResult.added.length} Panopticon skills`);
      if (skillsResult.skipped.length > 0) {
        console.log(`  Skipped: ${chalk.dim(skillsResult.skipped.join(', '))}`);
      }
      console.log('');
    }

    console.log(chalk.bold('Beads:'));
    if (beadsResult.success && workspaceBeadId) {
      console.log(`  Status:  ${chalk.green('Initialized fresh')}`);
      console.log(`  Task:    ${chalk.cyan(workspaceBeadId)}`);
    } else {
      console.log(`  Status:  ${chalk.yellow('Not initialized')} - ${beadsResult.error || 'unknown error'}`);
    }
    console.log('');

    if (options.docker) {
      console.log(chalk.bold('Docker:'));
      if (dockerStarted) {
        console.log(`  Status: ${chalk.green('Containers started')}`);
      } else {
        console.log(`  Status: ${chalk.yellow('Not started')} - ${dockerError}`);
      }
      console.log('');
    }

    console.log(chalk.dim(`Next: cd ${workspacePath}`));

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}

interface ListOptions {
  json?: boolean;
  all?: boolean;
}

async function listCommand(options: ListOptions): Promise<void> {
  const projects = listProjects();

  // If we have registered projects and --all is specified, list across all projects
  if (projects.length > 0 && options.all) {
    const allWorkspaces: Array<{
      projectName: string;
      projectPath: string;
      workspaces: ReturnType<typeof listWorktrees>;
    }> = [];

    for (const { key, config } of projects) {
      if (!existsSync(join(config.path, '.git'))) {
        continue;
      }

      const worktrees = listWorktrees(config.path);
      const workspaces = worktrees.filter(
        (w) => w.path.includes('/workspaces/') || w.path.includes('\\workspaces\\')
      );

      if (workspaces.length > 0) {
        allWorkspaces.push({
          projectName: config.name,
          projectPath: config.path,
          workspaces,
        });
      }
    }

    if (options.json) {
      console.log(JSON.stringify(allWorkspaces, null, 2));
      return;
    }

    if (allWorkspaces.length === 0) {
      console.log(chalk.dim('No workspaces found in any registered project.'));
      console.log(chalk.dim('Create one with: pan workspace create <issue-id>'));
      return;
    }

    for (const proj of allWorkspaces) {
      console.log(chalk.bold(`\n${proj.projectName}\n`));
      for (const ws of proj.workspaces) {
        const name = basename(ws.path);
        const status = ws.prunable ? chalk.yellow(' (prunable)') : '';
        console.log(`  ${chalk.cyan(name)}${status}`);
        console.log(`    Branch: ${ws.branch || chalk.dim('(detached)')}`);
        console.log(`    Path:   ${chalk.dim(ws.path)}`);
      }
    }
    return;
  }

  // Default behavior: list from current directory
  const projectRoot = process.cwd();

  if (!existsSync(join(projectRoot, '.git'))) {
    console.error(chalk.red('Not a git repository.'));
    if (projects.length > 0) {
      console.log(chalk.dim('Tip: Use --all to list workspaces across all registered projects.'));
    }
    process.exit(1);
  }

  const worktrees = listWorktrees(projectRoot);

  // Filter to workspaces directory only
  const workspaces = worktrees.filter((w) =>
    w.path.includes('/workspaces/') || w.path.includes('\\workspaces\\')
  );

  if (options.json) {
    console.log(JSON.stringify(workspaces, null, 2));
    return;
  }

  if (workspaces.length === 0) {
    console.log(chalk.dim('No workspaces found.'));
    console.log(chalk.dim('Create one with: pan workspace create <issue-id>'));
    if (projects.length > 0) {
      console.log(chalk.dim('Tip: Use --all to list workspaces across all registered projects.'));
    }
    return;
  }

  console.log(chalk.bold('\nWorkspaces\n'));

  for (const ws of workspaces) {
    const name = basename(ws.path);
    const status = ws.prunable ? chalk.yellow(' (prunable)') : '';
    console.log(`${chalk.cyan(name)}${status}`);
    console.log(`  Branch: ${ws.branch || chalk.dim('(detached)')}`);
    console.log(`  Path:   ${chalk.dim(ws.path)}`);
    console.log('');
  }
}

interface DestroyOptions {
  force?: boolean;
  project?: string;
}

async function destroyCommand(issueId: string, options: DestroyOptions): Promise<void> {
  const spinner = ora('Destroying workspace...').start();

  try {
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const folderName = `feature-${normalizedId}`;

    // Try to find project config from registry
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

    // Priority 1: Use workspace-manager if project has workspace config
    if (projectConfig?.workspace) {
      spinner.text = 'Removing workspace...';

      const result = await removeWorkspaceFromConfig({
        projectConfig,
        featureName: normalizedId,
      });

      if (result.success) {
        spinner.succeed('Workspace destroyed!');
        console.log('');
        for (const step of result.steps) {
          console.log(`  ${chalk.green('✓')} ${step}`);
        }
      } else {
        spinner.fail('Workspace destruction failed');
        for (const error of result.errors) {
          console.error(chalk.red(`  ${error}`));
        }
        process.exit(1);
      }
      return;
    }

    // Priority 2: Use custom workspace_remove_command (legacy)
    if (projectConfig?.workspace_remove_command) {
      spinner.text = 'Running custom remove command...';

      const cmd = `${projectConfig.workspace_remove_command} ${normalizedId}`;
      try {
        const { stdout } = await execAsync(cmd, {
          cwd: projectConfig.path,
          encoding: 'utf-8',
          timeout: 120000,
        });

        if (stdout) {
          console.log(stdout);
        }

        spinner.succeed('Workspace destroyed via custom command!');
        return;
      } catch (error: any) {
        spinner.fail(`Custom remove command failed: ${error.message}`);
        process.exit(1);
      }
    }

    // Priority 3: Simple worktree removal
    let projectRoot: string;

    if (options.project) {
      projectRoot = options.project;
    } else {
      const resolved = resolveProjectFromIssue(issueId);
      if (resolved) {
        projectRoot = resolved.projectPath;
      } else {
        projectRoot = process.cwd();
      }
    }

    const workspacePath = join(projectRoot, 'workspaces', folderName);

    if (!existsSync(workspacePath)) {
      const cwdPath = join(process.cwd(), 'workspaces', folderName);
      if (projectRoot !== process.cwd() && existsSync(cwdPath)) {
        projectRoot = process.cwd();
      } else {
        spinner.fail(`Workspace not found: ${workspacePath}`);
        process.exit(1);
      }
    }

    const finalWorkspacePath = join(projectRoot, 'workspaces', folderName);

    spinner.text = 'Removing git worktree...';
    removeWorktree(projectRoot, finalWorkspacePath);

    spinner.succeed(`Workspace destroyed: ${folderName}`);
  } catch (error: any) {
    spinner.fail(error.message);
    if (!options.force) {
      console.log(chalk.dim('Tip: Use --force to remove even with uncommitted changes'));
    }
    process.exit(1);
  }
}
