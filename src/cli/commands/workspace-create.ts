import chalk from 'chalk';
import ora from 'ora';
import { exec, execSync } from 'child_process';
import { existsSync, lstatSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { assembleWorkspaceContext, workspaceContextFile } from '../../lib/context-layers/index.js';
import { loadConfigSync } from '../../lib/config.js';
import {
  PAN_CONTEXT_FILENAME,
  PAN_CONTINUE_FILENAME,
  PAN_DIRNAME,
  PAN_FEEDBACK_DIRNAME,
  PAN_SESSIONS_FILENAME,
} from '../../lib/pan-dir/index.js';
import {
  extractTeamPrefix,
  findProjectByTeamSync,
  hasProjectsSync,
  resolveProjectFromIssueSync,
} from '../../lib/projects.js';
import { mergeSkillsIntoWorkspaceSync } from '../../lib/skills-merge.js';
import { generateClaudeMdSync, TemplateVariables } from '../../lib/template.js';
import { createWorkspace as createWorkspaceFromConfig } from '../../lib/workspace-manager.js';
import { createWorktree } from '../../lib/worktree.js';
import { initializeWorkspaceBeads } from './workspace-beads.js';
import { createRemoteWorkspace } from './workspace-remote.js';

const execAsync = promisify(exec);

export interface CreateOptions {
  dryRun?: boolean;
  skills?: boolean;
  labels?: string;
  project?: string;
  docker?: boolean;
  remote?: boolean;
  local?: boolean;
}

export async function createCommand(issueId: string, options: CreateOptions): Promise<void> {
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
