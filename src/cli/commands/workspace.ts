import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync, lstatSync, unlinkSync } from 'fs';
import { join, basename, resolve, dirname } from 'path';
import { createWorktree, removeWorktree, listWorktrees, type WorktreeInfo } from '../../lib/worktree.js';
import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { PAN_DIRNAME, PAN_CONTINUE_FILENAME, PAN_CONTEXT_FILENAME, PAN_FEEDBACK_DIRNAME, PAN_SESSIONS_FILENAME } from '../../lib/pan-dir/index.js';
import { generateClaudeMdSync, TemplateVariables } from '../../lib/template.js';
import { assembleWorkspaceContext, workspaceContextFile } from '../../lib/context-layers/index.js';
import { mergeSkillsIntoWorkspaceSync, applyProjectTemplateOverlaySync } from '../../lib/skills-merge.js';
import { listRunningAgentsSync } from '../../lib/agents.js';
import {
  resolveProjectFromIssueSync,
  hasProjectsSync,
  PROJECTS_CONFIG_FILE,
  findProjectByTeamSync,
  extractTeamPrefix,
  listProjectsSync,
  getProjectSync,
} from '../../lib/projects.js';
import {
  createWorkspace as createWorkspaceFromConfig,
  removeWorkspace as removeWorkspaceFromConfig,
  addReposToWorkspace,
  copyOverdeckSettingsToWorkspaceSync,
} from '../../lib/workspace-manager.js';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { loadConfigSync } from '../../lib/config.js';
import { loadWorkspaceMetadataSync } from '../../lib/remote/workspace-metadata.js';
import { initializeWorkspaceBeads } from './workspace-beads.js';
import {
  createRemoteWorkspace,
  destroyRemoteWorkspace,
  migrateCommand,
  sshCommand,
  startCommand,
  stopCommand,
  syncAuthCommand,
} from './workspace-remote.js';

const execAsync = promisify(exec);
export { __testInternals } from './workspace-beads.js';

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

interface CreateOptions {
  dryRun?: boolean;
  skills?: boolean;
  labels?: string;
  project?: string;
  docker?: boolean;
  remote?: boolean;
  local?: boolean;
}

async function createCommand(issueId: string, options: CreateOptions): Promise<void> {
  const spinner = ora('Creating workspace...').start();

  try {
    // Normalize issue ID (e.g., MIN-123 -> min-123)
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const branchName = `feature/${normalizedId}`;
    const folderName = `feature-${normalizedId}`;

    // Determine if we should create remote or local workspace
    const config = loadConfigSync();
    const remoteConfig = config.remote;
    let useRemote = false;

    if (options.remote && options.local) {
      spinner.fail('Cannot specify both --remote and --local');
      process.exit(1);
    }

    if (options.remote) {
      useRemote = true;
    } else if (options.local) {
      useRemote = false;
    } else if (remoteConfig?.enabled && remoteConfig.default_location === 'remote') {
      useRemote = true;
    }

    // Handle remote workspace creation
    if (useRemote) {
      spinner.text = 'Creating remote workspace...';
      await createRemoteWorkspace(issueId, normalizedId, branchName, spinner, options);
      return;
    }

    // Parse labels if provided
    const labels = options.labels
      ? options.labels.split(',').map((l) => l.trim())
      : [];

    // Try to find project config from registry
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;

    // Priority 1: Use workspace-manager if project has workspace config
    if (projectConfig?.workspace) {
      spinner.text = 'Creating workspace from config...';

      const result = await Effect.runPromise(createWorkspaceFromConfig({
        projectConfig,
        featureName: normalizedId,
        startDocker: options.docker,
        dryRun: options.dryRun,
      }));

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
      const resolved = resolveProjectFromIssueSync(issueId, labels);
      if (resolved) {
        projectRoot = resolved.projectPath;
        projectName = resolved.projectName;
        spinner.text = `Resolved project: ${projectName} (${projectRoot})`;
      } else if (hasProjectsSync()) {
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
    await Effect.runPromise(
      createWorktree(projectRoot, workspacePath, branchName).pipe(Effect.provide(nodeServicesLayer)),
    );

    // Clear stale workspace-local runtime state inherited from main.
    // Keep canonical plan state (.pan/spec.vbrief.json); clear only mutable
    // per-workspace artifacts that would belong to a previous issue/session.
    const resolvedWorkspace = resolve(workspacePath);
    const resolvedPanDir = resolve(resolvedWorkspace, PAN_DIRNAME);
    const isUnderWorkspacesDir = resolvedWorkspace.match(/\/workspaces\/feature-[a-z0-9-]+$/);
    if (isUnderWorkspacesDir && existsSync(join(resolvedWorkspace, '.git'))) {
      if (resolvedPanDir === join(resolvedWorkspace, PAN_DIRNAME) && existsSync(resolvedPanDir)) {
        for (const filePath of [
          join(resolvedPanDir, PAN_CONTINUE_FILENAME),
          join(resolvedPanDir, PAN_SESSIONS_FILENAME),
          join(resolvedPanDir, PAN_CONTEXT_FILENAME),
        ]) {
          if (existsSync(filePath)) {
            unlinkSync(filePath);
          }
        }

        const feedbackDir = join(resolvedPanDir, PAN_FEEDBACK_DIRNAME);
        if (existsSync(feedbackDir)) {
          rmSync(feedbackDir, { recursive: true, force: true });
        }
      }

      console.log('  Cleared stale workspace-local .pan runtime state');
    }

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

    const claudeMd = generateClaudeMdSync(variables);
    writeFileSync(join(workspacePath, 'CLAUDE.md'), claudeMd);

    // PAN-1201: assemble the workspace context layer. The bundle composes the
    // parent project's layer with issue metadata; PAN-1052 memory injection
    // and live status are layered on at spawn time. Non-fatal on failure.
    try {
      const wsContext = assembleWorkspaceContext({
        projectRoot,
        harness: 'claude-code',
        issueId: issueId.toUpperCase(),
        workspacePath,
        branch: branchName,
      });
      const wsContextFile = workspaceContextFile(workspacePath);
      mkdirSync(dirname(wsContextFile), { recursive: true });
      writeFileSync(wsContextFile, wsContext);
    } catch (err) {
      spinner.warn(`Could not assemble workspace context layer: ${(err as Error).message}`);
    }

    // Merge skills, agents, and rules (unless disabled)
    let skillsResult = { added: [] as string[], updated: [] as string[], skipped: [] as string[], overlayed: [] as string[] };
    if (options.skills !== false) {
      spinner.text = 'Merging skills and agents...';
      skillsResult = mergeSkillsIntoWorkspaceSync(workspacePath);
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

      // Self-heal: if the workspace already exists from an earlier run but
      // `.devcontainer/` was deleted (the original PAN-955 bug), regenerate
      // it from the project template before looking for a compose file.
      // Idempotent — no-op when `.devcontainer/` is already present.
      if (!composeLocations.some(f => existsSync(f))) {
        const { ensureDevcontainerSync } = await import('../../lib/workspace/ensure-devcontainer.js');
        const ensure = ensureDevcontainerSync({ workspacePath, issueId });
        if (ensure.rendered) {
          spinner.text = 'Regenerated .devcontainer/ from project template';
        }
      }

      const composeFile = composeLocations.find(f => existsSync(f));

      if (composeFile) {
        spinner.text = 'Starting Docker containers...';
        try {
          const composeDir = join(composeFile, '..');
          // Don't pass -p: the compose file's `name:` field is the authority
          await execAsync(`docker compose -f "${composeFile}" up -d --build`, {
            cwd: composeDir,
            encoding: 'utf-8',
            timeout: 300000,
          });
          dockerStarted = true;

          // Docker named volumes may create root-owned empty node_modules dirs.
          // Remove them so bun install can create proper workspace-aware node_modules.
          for (const nmDir of [join(workspacePath, 'node_modules'), join(workspacePath, 'src', 'dashboard', 'frontend', 'node_modules')]) {
            try {
              if (existsSync(nmDir) && !lstatSync(nmDir).isSymbolicLink()) {
                rmSync(nmDir, { recursive: true, force: true });
              }
            } catch {
              spinner.warn(`Could not remove Docker-created ${nmDir} — may need: sudo rm -rf "${nmDir}"`);
            }
          }
        } catch (err: any) {
          dockerError = err.message;
        }
      } else {
        dockerError = 'No docker-compose.yml found in workspace';
      }
    }

    // Install dependencies using the project's package manager.
    // Each worktree needs its own node_modules so that local workspace packages
    // (e.g., @overdeck/contracts) resolve to the worktree's code, not the main repo's.
    const pkgManager = projectConfig?.package_manager || (existsSync(join(workspacePath, 'bun.lock')) ? 'bun' : 'npm');
    const installCmd = pkgManager === 'bun' ? 'bun install' : `${pkgManager} install`;
    spinner.text = `Installing dependencies (${pkgManager})...`;
    try {
      execSync(installCmd, { cwd: workspacePath, encoding: 'utf-8', timeout: 60000, stdio: 'pipe' });
    } catch (installErr: any) {
      spinner.warn(`Dependency install warning: ${installErr.message?.slice(0, 200)}`);
    }

    // Build workspace packages so local dependencies have up-to-date dist/
    const workspacePackages = (projectConfig as any)?.workspace_packages as Array<{ path: string; build_command: string }> | undefined;
    if (workspacePackages) {
      for (const pkg of workspacePackages) {
        spinner.text = `Building ${pkg.path}...`;
        try {
          execSync(pkg.build_command, { cwd: join(workspacePath, pkg.path), encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
        } catch (buildErr: any) {
          spinner.warn(`Build warning (${pkg.path}): ${buildErr.message?.slice(0, 200)}`);
        }
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
      const totalMerged = skillsResult.added.length + skillsResult.updated.length;
      console.log(chalk.bold('Skills & Agents:'));
      console.log(`  Installed: ${totalMerged} files (${skillsResult.added.length} new, ${skillsResult.updated.length} updated)`);
      if (skillsResult.skipped.length > 0) {
        console.log(`  Skipped:   ${chalk.dim(skillsResult.skipped.join(', '))}`);
      }
      if (skillsResult.overlayed.length > 0) {
        console.log(`  Overlayed: ${skillsResult.overlayed.length} project template files`);
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
  const projects = listProjectsSync();

  // If we have registered projects and --all is specified, list across all projects
  if (projects.length > 0 && options.all) {
    const allWorkspaces: Array<{
      projectName: string;
      projectPath: string;
      workspaces: WorktreeInfo[];
    }> = [];

    for (const { key, config } of projects) {
      // For polyrepo projects, list worktrees from each sub-repo
      const isPolyrepo = config.workspace?.type === 'polyrepo' && config.workspace?.repos;
      const workspaces: WorktreeInfo[] = [];

      if (isPolyrepo && config.workspace?.repos) {
        // Polyrepo: scan each configured repo for worktrees
        for (const repo of config.workspace.repos) {
          const repoPath = join(config.path, repo.path);
          if (!existsSync(join(repoPath, '.git'))) continue;
          const repoWorktrees = await Effect.runPromise(
            listWorktrees(repoPath).pipe(Effect.provide(nodeServicesLayer)),
          );
          for (const wt of repoWorktrees) {
            if (wt.path.includes('/workspaces/') || wt.path.includes('\\workspaces\\')) {
              // Deduplicate: polyrepo workspaces share a parent dir (e.g., feature-min-697/fe, feature-min-697/api)
              // Use the parent workspace dir as the canonical path
              const parts = wt.path.split('/workspaces/');
              if (parts.length > 1) {
                const workspaceDir = parts[1].split('/')[0]; // e.g., "feature-min-697"
                const canonicalPath = join(config.path, 'workspaces', workspaceDir);
                if (!workspaces.some(w => w.path === canonicalPath)) {
                  workspaces.push({ ...wt, path: canonicalPath });
                }
              }
            }
          }
        }
      } else {
        // Monorepo: scan project root
        if (!existsSync(join(config.path, '.git'))) continue;
        const worktrees = await Effect.runPromise(
          listWorktrees(config.path).pipe(Effect.provide(nodeServicesLayer)),
        );
        for (const wt of worktrees) {
          if (wt.path.includes('/workspaces/') || wt.path.includes('\\workspaces\\')) {
            workspaces.push(wt);
          }
        }
      }

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

  const worktrees = await Effect.runPromise(
    listWorktrees(projectRoot).pipe(Effect.provide(nodeServicesLayer)),
  );

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

export async function destroyCommand(issueId: string, options: DestroyOptions): Promise<void> {
  const spinner = ora('Destroying workspace...').start();

  try {
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const folderName = `feature-${normalizedId}`;

    // Check if this is a remote workspace
    const metadata = loadWorkspaceMetadataSync(normalizedId);
    if (metadata && metadata.location === 'remote') {
      await destroyRemoteWorkspace(issueId, normalizedId, metadata, spinner, options);
      return;
    }

    // Try to find project config from registry
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;

    // Priority 1: Use workspace-manager if project has workspace config
    if (projectConfig?.workspace) {
      spinner.text = 'Removing workspace...';

      const result = await Effect.runPromise(removeWorkspaceFromConfig({
        projectConfig,
        featureName: normalizedId,
      }));

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
      const resolved = resolveProjectFromIssueSync(issueId);
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
    await Effect.runPromise(
      removeWorktree(projectRoot, finalWorkspacePath).pipe(Effect.provide(nodeServicesLayer)),
    );

    spinner.succeed(`Workspace destroyed: ${folderName}`);
  } catch (error: any) {
    spinner.fail(error.message);
    if (!options.force) {
      console.log(chalk.dim('Tip: Use --force to remove even with uncommitted changes'));
    }
    process.exit(1);
  }
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
