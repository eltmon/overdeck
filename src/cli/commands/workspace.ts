import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync, symlinkSync, lstatSync, chmodSync, unlinkSync } from 'fs';
import { join, basename, resolve, dirname } from 'path';
import { createWorktree, removeWorktree, listWorktrees, type WorktreeInfo } from '../../lib/worktree.js';
import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import { PAN_DIRNAME, PAN_CONTINUE_FILENAME, PAN_CONTEXT_FILENAME, PAN_FEEDBACK_DIRNAME, PAN_SESSIONS_FILENAME } from '../../lib/pan-dir/index.js';
import { generateClaudeMd, TemplateVariables } from '../../lib/template.js';
import { assembleWorkspaceContext, workspaceContextFile } from '../../lib/context-layers/index.js';
import { mergeSkillsIntoWorkspace, applyProjectTemplateOverlay } from '../../lib/skills-merge.js';
import { listRunningAgents } from '../../lib/agents.js';
import {
  resolveProjectFromIssue,
  hasProjects,
  PROJECTS_CONFIG_FILE,
  findProjectByTeam,
  extractTeamPrefix,
  listProjects,
  getIssuePrefix,
  getProject,
} from '../../lib/projects.js';
import {
  createWorkspace as createWorkspaceFromConfig,
  removeWorkspace as removeWorkspaceFromConfig,
  addReposToWorkspace,
  copyPanopticonSettingsToWorkspace,
} from '../../lib/workspace-manager.js';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { loadConfig } from '../../lib/config.js';
import { buildClaudeUserSettings } from '../../lib/claude-permissions.js';
import { createFlyProviderFromConfig, isRemoteAvailable } from '../../lib/remote/index.js';
import type { RemoteWorkspaceMetadata } from '../../lib/remote/interface.js';
import {
  saveWorkspaceMetadata,
  loadWorkspaceMetadata,
  listWorkspaceMetadata,
  WORKSPACES_DIR,
} from '../../lib/remote/workspace-metadata.js';

const execAsync = promisify(exec);
const REDIRECT_MANAGED_BEADS_VERSION = 1 * 10000 + 0 * 100 + 4;

function encodeBeadsVersion(version: string): number {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return 0;
  const [, major, minor, patch] = match.map(Number);
  return major * 10000 + minor * 100 + patch;
}

/**
 * Check beads version to determine which approach to use
 * Returns version as a sortable semver number (e.g., v1.0.4 = 10004) or 0 if not installed
 */
async function getBeadsVersion(): Promise<number> {
  try {
    const { stdout } = await execAsync('bd --version', { encoding: 'utf-8' });
    return encodeBeadsVersion(stdout);
  } catch {}
  return 0;
}

/**
 * Convert HTTPS git URLs to SSH format for remote VM cloning
 * Remote VMs use SSH keys for authentication, not HTTPS credentials
 *
 * Examples:
 *   https://github.com/owner/repo.git → git@github.com:owner/repo.git
 *   https://gitlab.com/owner/repo.git → git@gitlab.com:owner/repo.git
 */
function convertToSshUrl(httpsUrl: string): string {
  // Match common HTTPS git URL patterns
  const httpsPattern = /^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/;
  const match = httpsUrl.match(httpsPattern);

  if (match) {
    const [, host, path] = match;
    // Ensure .git suffix
    const repoPath = path.endsWith('.git') ? path : `${path}.git`;
    return `git@${host}:${repoPath}`;
  }

  // Already SSH format or unrecognized - return as-is
  return httpsUrl;
}

/**
 * Initialize beads for a workspace
 *
 * Beads v0.47.1+ uses shared database with labels for isolation (recommended)
 * Older versions use separate .beads directories (legacy workaround)
 */
async function initializeWorkspaceBeads(workspacePath: string, issueId: string): Promise<{ success: boolean; beadId?: string; error?: string }> {
  try {
    const beadsVersion = await getBeadsVersion();

    if (beadsVersion >= REDIRECT_MANAGED_BEADS_VERSION) {
      // v1.0.4+ - Use shared database with issue label for scoping
      // The worktree's .beads/ directory is created from git (only issues.jsonl is committed),
      // so it lacks the redirect file needed to find the main repo's Dolt database.
      // We must create .beads/redirect explicitly — it is gitignored so cannot be inherited.
      const beadsDir = join(workspacePath, '.beads');
      const redirectPath = join(beadsDir, 'redirect');
      if (!existsSync(redirectPath)) {
        // Walk up from workspacePath to find the main repo's .beads/ directory
        // Worktrees live at <projectRoot>/workspaces/feature-<id>/ — two levels up
        const projectRoot = resolve(workspacePath, '..', '..');
        const mainBeadsDir = join(projectRoot, '.beads');
        if (existsSync(mainBeadsDir)) {
          mkdirSync(beadsDir, { recursive: true });
          chmodSync(beadsDir, 0o700);
          // Write relative path from workspace .beads/ to main .beads/
          writeFileSync(redirectPath, '../../.beads', 'utf-8');
        }
      }

      // Use bare issueId label (e.g. "pan-419") matching createBeadsFromVBrief and all query sites
      const issueLabel = issueId.toLowerCase();
      const title = `${issueId.toUpperCase()}: Implementation`;

      const { stdout } = await execAsync(
        `bd create --title "${title}" --priority 1 --type task --labels "${issueLabel}" 2>&1`,
        { cwd: workspacePath, encoding: 'utf-8' }
      );

      // Parse the created bead ID
      const match = stdout.match(/([a-z]+-[a-z0-9]+)/);
      return { success: true, beadId: match?.[1] };
    } else {
      // Legacy approach for older beads versions (< 1.0.4)
      // Remove inherited .beads directory and initialize fresh
      const beadsDir = join(workspacePath, '.beads');
      if (existsSync(beadsDir)) {
        rmSync(beadsDir, { recursive: true, force: true });
      }

      const prefix = 'workspace';
      await execAsync(`bd init --prefix ${prefix}`, { cwd: workspacePath, encoding: 'utf-8' });
      await execAsync('git config beads.role contributor', { cwd: workspacePath }).catch(() => {});
      // Disable beads' auto-export git-add to prevent "git add failed" warnings in worktrees
      await execAsync('bd config set export.git-add false', { cwd: workspacePath, encoding: 'utf-8' }).catch(() => {});

      const title = `${issueId.toUpperCase()}: Implementation`;
      const { stdout } = await execAsync(
        `bd create --title "${title}" --priority 1 --type task --json`,
        { cwd: workspacePath, encoding: 'utf-8' }
      );

      try {
        const result = JSON.parse(stdout);
        return { success: true, beadId: result.id };
      } catch {
        const match = stdout.match(/([a-z]+-[a-z0-9]+)/);
        return { success: true, beadId: match?.[1] };
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export const __testInternals = {
  encodeBeadsVersion,
  REDIRECT_MANAGED_BEADS_VERSION,
};

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
    .description('Migrate workspace between local and remote')
    .option('--to <location>', 'Target location: "remote" or "local"')
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
    .description('Copy installed Panopticon config into workspace (makes it user settings)')
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
    const config = loadConfig();
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

    const claudeMd = generateClaudeMd(projectRoot, variables);
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

      // Self-heal: if the workspace already exists from an earlier run but
      // `.devcontainer/` was deleted (the original PAN-955 bug), regenerate
      // it from the project template before looking for a compose file.
      // Idempotent — no-op when `.devcontainer/` is already present.
      if (!composeLocations.some(f => existsSync(f))) {
        const { ensureDevcontainer } = await import('../../lib/workspace/ensure-devcontainer.js');
        const ensure = ensureDevcontainer({ workspacePath, issueId });
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
    // (e.g., @panctl/contracts) resolve to the worktree's code, not the main repo's.
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
  const projects = listProjects();

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
    const metadata = loadWorkspaceMetadata(normalizedId);
    if (metadata && metadata.location === 'remote') {
      await destroyRemoteWorkspace(issueId, normalizedId, metadata, spinner, options);
      return;
    }

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

// ============================================================================
// Remote Workspace Functions
// ============================================================================

/**
 * Create a remote workspace on Fly.io
 */
async function createRemoteWorkspace(
  issueId: string,
  normalizedId: string,
  branchName: string,
  spinner: Ora,
  options: CreateOptions
): Promise<void> {
  const config = loadConfig();
  const remoteConfig = config.remote;

  if (!remoteConfig?.enabled) {
    spinner.fail('Remote workspaces not enabled');
    console.log('');
    console.log(chalk.dim('Run: pan remote setup'));
    process.exit(1);
  }

  // Check availability
  const availability = await isRemoteAvailable();
  if (!availability.available) {
    spinner.fail('Remote not available');
    console.log('');
    console.log(chalk.yellow(availability.reason || 'Unknown error'));
    process.exit(1);
  }

  const fly = createFlyProviderFromConfig(remoteConfig);

  // Determine project context first (needed for VM naming)
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
  const projectRoot = projectConfig?.path || process.cwd();

  // Determine project identifier for VM name
  // Priority: team prefix from issue > linear_team from project > repo name
  let projectId = teamPrefix?.toLowerCase();
  if (!projectId && projectConfig && getIssuePrefix(projectConfig)) {
    projectId = getIssuePrefix(projectConfig)!.toLowerCase();
  }
  if (!projectId) {
    // Fall back to git repo name
    try {
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      const repoMatch = stdout.trim().match(/\/([^\/]+?)(\.git)?$/);
      projectId = repoMatch ? repoMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '-') : 'proj';
    } catch {
      projectId = 'proj';
    }
  }

  // VM names must be valid hostnames (start with letter, alphanumeric + hyphens)
  // Include project ID to avoid collisions across projects
  const vmName = `${projectId}-${normalizedId}-ws`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (options.dryRun) {
    spinner.info('Dry run - would create remote workspace');
    console.log('');
    console.log(chalk.bold('Would create:'));
    console.log(`  VM:        ${chalk.cyan(vmName)}`);
    console.log(`  Project:   ${chalk.dim(projectId)}`);
    console.log(`  Branch:    ${chalk.dim(branchName)}`);
    return;
  }

  try {
    // Step 1: Create VM
    spinner.text = 'Creating VM (this may take 1-2 minutes)...';
    const vmInfo = await Effect.runPromise(fly.createVm(vmName));

    // Get git remote URL
    let repoUrl = '';
    try {
      const { stdout } = await execAsync('git remote get-url origin', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      repoUrl = stdout.trim();
    } catch {
      spinner.fail('Could not determine git remote URL');
      console.log('');
      console.log(chalk.dim('Make sure you are in a git repository with a remote origin.'));
      // Clean up VM
      await fly.deleteVm(vmName);
      process.exit(1);
    }

    // Step 3: Add SSH host keys and clone repository on VM
    spinner.text = 'Cloning repository on VM...';

    // Detect git host from repo URL
    const isGitHub = repoUrl.includes('github.com');
    const isGitLab = repoUrl.includes('gitlab.com');
    const gitHost = isGitHub ? 'github.com' : isGitLab ? 'gitlab.com' : null;

    // Add SSH host keys to known_hosts for the detected host
    await fly.ssh(vmName, 'mkdir -p ~/.ssh && chmod 700 ~/.ssh');
    if (gitHost) {
      await fly.ssh(vmName, `ssh-keyscan -t ed25519,rsa ${gitHost} >> ~/.ssh/known_hosts 2>/dev/null`);
    }

    // Inject SSH key for git access if available
    // Check multiple locations: panopticon-specific key first, then standard SSH keys
    const sshKeyPaths = [
      join(homedir(), '.panopticon', 'ssh', 'exe-dev-key'),
      join(homedir(), '.ssh', 'id_ed25519'),
      join(homedir(), '.ssh', 'id_rsa'),
    ];
    const sshKeyPath = sshKeyPaths.find((p) => existsSync(p));
    if (sshKeyPath) {
      const sshKeyBase64 = Buffer.from(readFileSync(sshKeyPath, 'utf-8')).toString('base64');
      // Determine key type from filename for remote VM
      const keyFilename = sshKeyPath.includes('id_rsa') ? 'id_rsa' : 'id_ed25519';
      await fly.ssh(vmName, `echo '${sshKeyBase64}' | base64 -d > ~/.ssh/${keyFilename} && chmod 600 ~/.ssh/${keyFilename}`);
    }

    // Sync git CLI auth for the detected host
    if (isGitHub) {
      // GitHub: sync gh CLI auth
      await fly.syncGitHubAuth(vmName);
    } else if (isGitLab) {
      // GitLab: sync glab CLI auth
      spinner.text = 'Syncing GitLab credentials...';
      await fly.syncGitLabAuth(vmName);
    }

    // Check if this is a polyrepo project
    const isPolyrepo = projectConfig?.workspace?.type === 'polyrepo' && projectConfig.workspace.repos;

    if (isPolyrepo) {
      // Polyrepo: Clone each repo separately
      spinner.text = 'Cloning repositories (polyrepo)...';
      await fly.ssh(vmName, 'mkdir -p ~/workspace');

      for (const repo of projectConfig!.workspace!.repos!) {
        spinner.text = `Cloning ${repo.name}...`;

        // Resolve symlink to get actual repo path
        const rawRepoPath = join(projectRoot, repo.path);
        const actualRepoPath = existsSync(rawRepoPath) ? realpathSync(rawRepoPath) : rawRepoPath;

        // Get git remote URL for this repo
        let repoRemoteUrl: string;
        try {
          const { stdout } = await execAsync('git remote get-url origin', {
            cwd: actualRepoPath,
            encoding: 'utf-8',
          });
          repoRemoteUrl = convertToSshUrl(stdout.trim());
        } catch (err) {
          throw new Error(`Failed to get remote URL for ${repo.name} at ${actualRepoPath}: ${err}`);
        }

        // Clone this repo on the remote VM
        const cloneResult = await Effect.runPromise(fly.ssh(vmName, `git clone ${repoRemoteUrl} ~/workspace/${repo.name}`));
        if (cloneResult.exitCode !== 0) {
          throw new Error(`Failed to clone ${repo.name}: ${cloneResult.stderr}`);
        }

        // Create feature branch for this repo
        const repoBranchPrefix = repo.branch_prefix || 'feature/';
        const repoBranchName = `${repoBranchPrefix}${normalizedId}`;
        const branchResult = await Effect.runPromise(fly.ssh(vmName, `cd ~/workspace/${repo.name} && git checkout -b ${repoBranchName}`));
        if (branchResult.exitCode !== 0) {
          // Branch might already exist remotely
          await Effect.runPromise(fly.ssh(vmName, `cd ~/workspace/${repo.name} && git checkout ${repoBranchName} || git checkout -b ${repoBranchName}`));
        }
      }

      spinner.text = 'Setting up workspace structure...';
    } else {
      // Single repo: use existing logic
      // Convert HTTPS URLs to SSH format for remote VM cloning
      // Remote VMs use SSH keys, not interactive HTTPS credentials
      const sshRepoUrl = convertToSshUrl(repoUrl);

      const cloneResult = await Effect.runPromise(fly.ssh(vmName, `git clone ${sshRepoUrl} ~/workspace`));
      if (cloneResult.exitCode !== 0) {
        throw new Error(`Failed to clone: ${cloneResult.stderr}`);
      }

      // Step 4: Create feature branch
      spinner.text = 'Creating feature branch...';
      const branchResult = await Effect.runPromise(fly.ssh(vmName, `cd ~/workspace && git checkout -b ${branchName}`));
      if (branchResult.exitCode !== 0) {
        // Branch might already exist remotely
        await Effect.runPromise(fly.ssh(vmName, `cd ~/workspace && git checkout ${branchName} || git checkout -b ${branchName}`));
      }
    }

    // Step 4.5: Create /workspace symlink for consistent paths
    await fly.ssh(vmName, `sudo ln -sf ~/workspace /workspace 2>/dev/null || true`);

    // Step 4.6: Configure Claude Code - copy credentials and skip onboarding
    spinner.text = 'Configuring Claude Code...';
    await fly.ssh(vmName, `mkdir -p ~/.claude`);

    // Copy credentials from macOS Keychain to remote
    try {
      const { stdout: credentials } = await execAsync(
        'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
        { encoding: 'utf-8' }
      );
      if (credentials && credentials.trim()) {
        const credsBase64 = Buffer.from(credentials.trim()).toString('base64');
        await fly.ssh(vmName, `echo '${credsBase64}' | base64 -d > ~/.claude/.credentials.json`);
      }
    } catch {
      spinner.warn('Could not copy Claude credentials - you may need to login on the VM');
    }

    // Set onboarding complete in ~/.claude.json (NOT ~/.claude/settings.json!)
    // This is the file Claude Code checks for onboarding status
    const onboardingPatch = `
import json
import os
path = os.path.expanduser("~/.claude.json")
data = {}
if os.path.exists(path):
    with open(path, "r") as f:
        data = json.load(f)
data["hasCompletedOnboarding"] = True
data["lastOnboardingVersion"] = "2.0.50"
with open(path, "w") as f:
    json.dump(data, f, indent=2)
`;
    const patchBase64 = Buffer.from(onboardingPatch).toString('base64');
    await fly.ssh(vmName, `echo '${patchBase64}' | base64 -d | python3`);

    // Write ~/.claude/settings.json on the remote VM honoring the user's
    // Panopticon permission mode. defaultMode here is what `claude` uses when
    // an invocation omits --permission-mode; hardcoding 'bypassPermissions'
    // would silently escalate any unflagged claude invocation on the VM
    // (interactive shells, future helper scripts) even when the user chose Auto.
    const claudeSettings = JSON.stringify(buildClaudeUserSettings());
    const settingsBase64 = Buffer.from(claudeSettings).toString('base64');
    await fly.ssh(vmName, `echo '${settingsBase64}' | base64 -d > ~/.claude/settings.json`);

    // Configure Claude Code for autonomous operation (onboarding-complete + permission mode per user setting)
    await fly.configureClaudeCode(vmName);

    // Step 4.7: Copy essential skills to remote VM
    spinner.text = 'Copying skills to remote VM...';
    await fly.copySkillsToVm(vmName);

    // Step 5: Install beads CLI on remote VM
    spinner.text = 'Installing beads CLI...';
    const bdInstalled = await fly.installBeads(vmName);
    if (bdInstalled) {
      await fly.initBeads(vmName, '~/workspace');
    }

    // Step 6: Save workspace metadata
    const metadata: RemoteWorkspaceMetadata = {
      id: normalizedId,
      issue: issueId.toUpperCase(),
      provider: 'fly',
      vmName,
      machineId: vmInfo.machineId,
      appName: fly.getAppName(),
      urls: {},
      created: new Date(),
      location: 'remote',
    };

    saveWorkspaceMetadata(metadata);

    spinner.succeed('Remote workspace created!');

    console.log('');
    console.log(chalk.bold('Workspace Details:'));
    console.log(`  Issue:    ${chalk.green(issueId.toUpperCase())}`);
    console.log(`  VM:       ${chalk.cyan(vmName)}`);
    console.log(`  Branch:   ${chalk.dim(branchName)}`);
    console.log(`  Location: ${chalk.yellow('Remote (Fly.io)')}`);
    console.log('');

    console.log(chalk.bold('Commands:'));
    console.log(`  SSH:    ${chalk.dim(`pan workspace ssh ${issueId}`)}`);
    console.log(`  Stop:   ${chalk.dim(`pan workspace stop ${issueId}`)}`);
    console.log(`  Delete: ${chalk.dim(`pan workspace destroy ${issueId}`)}`);
    console.log('');

  } catch (error: any) {
    spinner.fail(`Failed to create remote workspace: ${error.message}`);
    // Try to clean up
    try {
      await fly.deleteVm(vmName);
    } catch {
      // Ignore cleanup errors
    }
    process.exit(1);
  }
}

/**
 * Migrate workspace between local and remote
 */
interface MigrateOptions {
  to?: 'local' | 'remote';
}

async function migrateCommand(issueId: string, options: MigrateOptions): Promise<void> {
  const spinner = ora('Migrating workspace...').start();

  if (!options.to) {
    spinner.fail('Must specify target location: --to remote or --to local');
    process.exit(1);
  }

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (options.to === 'remote') {
    if (metadata?.location === 'remote') {
      spinner.info('Workspace is already remote');
      return;
    }

    // Persist beads before migrating
    spinner.text = 'Persisting beads...';
    try {
      await execAsync('bd dolt commit -m "Sync beads before migration"', { encoding: 'utf-8' });
      await execAsync('git add .beads/ && git commit -m "Sync beads before migration" && git push', { encoding: 'utf-8' });
    } catch {
      // Non-fatal - beads persistence might not be needed
    }

    // Create remote workspace
    const branchName = `feature/${normalizedId}`;
    await createRemoteWorkspace(issueId, normalizedId, branchName, spinner, {});

    spinner.succeed('Migrated to remote!');
    console.log('');
    console.log(chalk.dim('Local workspace remains unchanged. Delete it manually if no longer needed.'));

  } else if (options.to === 'local') {
    if (!metadata || metadata.location !== 'remote') {
      spinner.info('Workspace is already local (or not found)');
      return;
    }

    spinner.text = 'Migration to local not yet implemented';
    spinner.warn('Migration from remote to local coming soon');
    console.log('');
    console.log(chalk.dim('For now, create a local workspace manually:'));
    console.log(chalk.dim(`  pan workspace create ${issueId} --local`));
  }
}

/**
 * Sync Claude Code credentials to remote workspace
 */
async function syncAuthCommand(issueId: string): Promise<void> {
  const spinner = ora('Syncing credentials...').start();

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    console.log(chalk.dim('Create one with: pan workspace create --remote ' + issueId));
    process.exit(1);
  }

  try {
    const fly = createFlyProviderFromConfig(loadConfig().remote);

    // Sync all credentials (Claude, GitHub, etc.)
    const synced = await fly.syncAllCredentials(metadata.vmName);

    const allSynced = synced.claude && synced.github;
    if (allSynced) {
      spinner.succeed('All credentials synced to remote workspace');
      console.log(chalk.dim(`  VM: ${metadata.vmName}`));
      console.log(chalk.dim(`  Claude: ✓  GitHub: ✓`));
    } else {
      spinner.warn('Some credentials could not be synced');
      console.log(chalk.dim(`  VM: ${metadata.vmName}`));
      console.log(chalk.dim(`  Claude: ${synced.claude ? '✓' : '✗'}  GitHub: ${synced.github ? '✓' : '✗'}`));
      console.log('');
      if (!synced.claude) {
        console.log(chalk.yellow('Claude Code credentials not found in Keychain.'));
        console.log(chalk.dim('You may need to authenticate Claude Code locally first:'));
        console.log(chalk.dim('  claude --help'));
      }
      if (!synced.github) {
        console.log(chalk.yellow('GitHub CLI auth not found in Keychain.'));
        console.log(chalk.dim('You may need to authenticate GitHub CLI locally first:'));
        console.log(chalk.dim('  gh auth login'));
      }
      console.log('');
      console.log(chalk.dim('Or SSH into the VM and authenticate directly:'));
      console.log(chalk.dim(`  pan workspace ssh ${issueId}`));
    }
  } catch (error: any) {
    spinner.fail(`Failed to sync credentials: ${error.message}`);
    process.exit(1);
  }
}

/**
 * SSH into remote workspace
 */
async function sshCommand(issueId: string): Promise<void> {
  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    console.error(chalk.red(`No remote workspace found for ${issueId}`));
    console.log(chalk.dim('Create one with: pan workspace create --remote ' + issueId));
    process.exit(1);
  }

  const { spawn } = await import('child_process');

  // Spawn interactive SSH session via Fly CLI
  const appName = metadata.appName || 'pan-workspaces';
  const child = spawn('fly', ['ssh', 'console', '-a', appName], {
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

/**
 * Start a stopped remote workspace
 */
async function startCommand(issueId: string): Promise<void> {
  const spinner = ora('Starting workspace...').start();

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    process.exit(1);
  }

  try {
    const fly = createFlyProviderFromConfig(loadConfig().remote);
    await fly.startVm(metadata.vmName);

    spinner.succeed(`Workspace ${issueId} started`);

    if (metadata.urls.frontend) {
      console.log(`  Frontend: ${chalk.cyan(metadata.urls.frontend)}`);
    }
    if (metadata.urls.api) {
      console.log(`  API:      ${chalk.cyan(metadata.urls.api)}`);
    }

  } catch (error: any) {
    spinner.fail(`Failed to start: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Stop (hibernate) a remote workspace
 */
async function stopCommand(issueId: string): Promise<void> {
  const spinner = ora('Stopping workspace...').start();

  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadata = loadWorkspaceMetadata(normalizedId);

  if (!metadata || metadata.location !== 'remote') {
    spinner.fail(`No remote workspace found for ${issueId}`);
    process.exit(1);
  }

  try {
    const fly = createFlyProviderFromConfig(loadConfig().remote);

    // Stop VM
    spinner.text = 'Hibernating VM...';
    await fly.stopVm(metadata.vmName);

    spinner.succeed(`Workspace ${issueId} stopped (hibernated)`);
    console.log(chalk.dim('  Start again with: pan workspace start ' + issueId));

  } catch (error: any) {
    spinner.fail(`Failed to stop: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Destroy a remote workspace
 */
async function destroyRemoteWorkspace(
  issueId: string,
  normalizedId: string,
  metadata: RemoteWorkspaceMetadata,
  spinner: Ora,
  options: DestroyOptions
): Promise<void> {
  const fly = createFlyProviderFromConfig(loadConfig().remote);

  try {
    // Step 1: Kill any running agent
    spinner.text = 'Stopping agent...';
    const agentId = `agent-${normalizedId}`;
    const { killRemoteAgent } = await import('../../lib/remote/remote-agents.js');
    await killRemoteAgent(agentId, metadata.vmName);

    // Step 2: Delete VM
    spinner.text = 'Deleting VM...';
    await fly.deleteVm(metadata.vmName);

    // Step 3: Remove workspace metadata file
    const metadataFile = join(WORKSPACES_DIR, `${normalizedId}.yaml`);
    if (existsSync(metadataFile)) {
      rmSync(metadataFile);
    }

    spinner.succeed(`Remote workspace ${issueId} destroyed`);
    console.log('');
    console.log(chalk.dim('  VM deleted, metadata removed.'));

  } catch (error: any) {
    spinner.fail(`Failed to destroy remote workspace: ${error.message}`);
    if (!options.force) {
      console.log(chalk.dim('  Tip: Use --force to forcefully clean up'));
    }
    process.exit(1);
  }
}

interface UseConfigOptions {
  project?: string;
}

async function useConfigCommand(issueId: string, options: UseConfigOptions): Promise<void> {
  const spinner = ora('Copying Panopticon config to workspace...').start();

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
      const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

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
    const result = copyPanopticonSettingsToWorkspace(workspacePath);

    if (result.errors.length > 0) {
      spinner.warn('Config copied with errors');
      for (const error of result.errors) {
        console.log(chalk.yellow(`  ⚠ ${error}`));
      }
    } else {
      spinner.succeed('Panopticon config copied to workspace');
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
    const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

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
    const runningAgents = listRunningAgents();
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
    const result = mergeSkillsIntoWorkspace(workspacePath);

    // Apply project template overlay if configured
    if (workspaceConfig?.agent?.template_dir && (workspaceConfig.agent.copy_dirs || workspaceConfig.agent.symlinks)) {
      spinner.text = 'Applying project template overlay...';
      const templateDir = join(projectConfig.path, workspaceConfig.agent.template_dir);
      const overlayed = applyProjectTemplateOverlay(workspacePath, templateDir);
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
    let projectConfig: ReturnType<typeof findProjectByTeam> = null;
    if (options.project) {
      projectConfig = getProject(options.project);
    }

    if (!projectConfig) {
      // Try to find project from workspace path
      const allProjects = listProjects();
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
    const result = await addReposToWorkspace({
      projectConfig,
      featureName: normalizedId,
      repoNames: targetRepoNames,
      dryRun: options.dryRun,
    });

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
