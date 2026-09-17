import { exitCli } from '../exit.js';
import chalk from 'chalk';
import type { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  listProjectsSync,
  unregisterProjectSync,
  getProjectSync,
  initializeProjectsConfigSync,
  PROJECTS_CONFIG_FILE,
  renameProjectSync,
  ProjectConfig,
  IssueRoutingRule,
  getIssuePrefix,
} from '../../lib/projects.js';
import { registerProjectFromPath, installGitHooksInDir, DuplicateProjectError } from '../../lib/project-registration.js';
import { addProjectTarget, upsertProjectFromConfig } from '../../lib/workspaces/writer.js';
import {
  resolveProjectCreateIntent,
  toPublicProjectIntent,
  ProjectCreateFailureError,
  type ProjectCreateInput,
  type ProjectCreateProgress,
  type ResolvedProjectIntent,
} from '../../lib/projects/create.js';
import { performProjectCreate, finishProjectSetup } from '../../lib/projects/create-perform.js';
import type { ProjectCreateFailure } from '../../lib/projects/create-errors.js';

/**
 * Print findings and exit non-zero.
 *
 * A finding means nothing was created, so the command has failed — returning 0
 * here let `pan project clone <bad-url>` succeed from a script's point of view.
 */
async function reportFindingsAndExit(intent: ResolvedProjectIntent): Promise<never> {
  console.error(chalk.yellow('\nValidation issues:'));
  for (const finding of intent.findings) {
    console.error(chalk.red(`  ✗ ${finding.field}: ${finding.message}`));
    if (finding.detail) console.error(chalk.dim(`    ${finding.detail}`));
  }
  console.error('');
  return exitCli(1);
}

/**
 * Print the resolved intent as one JSON document on stdout and nothing else.
 *
 * `--dry-run` exists to be piped into `jq`, so decorated prose defeats it. The
 * public projection is used so a credential-bearing transport URL is redacted.
 */
function printDryRun(intent: ResolvedProjectIntent): void {
  console.log(JSON.stringify(toPublicProjectIntent(intent), null, 2));
}

/** Report a typed failure, with its repair command when there is one. */
async function reportFailureAndExit(failure: ProjectCreateFailure): Promise<never> {
  console.error('');
  console.error(chalk.red(`✗ ${failure.message}`));
  if (failure.detail) console.error(chalk.dim(failure.detail));
  if (failure.recovery?.action === 'finish-setup') {
    // The repository is on disk and registered; creating again would clone a
    // second copy or hit the duplicate guard. Name the one command that works.
    console.error('');
    console.error(chalk.dim(`  Repair with: pan project finish-setup ${failure.recovery.key}`));
  } else if (failure.recovery?.action === 'use-existing') {
    console.error('');
    console.error(chalk.dim(`  Add the existing folder: pan project add ${failure.recovery.path}`));
  }
  console.error('');
  return exitCli(failure.code === 'cancelled' ? 130 : 1);
}

/**
 * Run a clone with SIGINT wired to a real abort.
 *
 * Ctrl-C has to stop the child and let cleanup settle before the process exits,
 * or it leaves a half-written directory behind. The previous listeners are
 * restored afterwards so a CLI test does not inherit a process-global handler.
 */
async function withInterruptibleClone<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const previous = process.listeners('SIGINT');
  const onInterrupt = (): void => {
    process.stderr.write('\nCancelling…\n');
    controller.abort();
  };

  process.removeAllListeners('SIGINT');
  process.on('SIGINT', onInterrupt);
  try {
    return await run(controller.signal);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    for (const listener of previous) {
      process.on('SIGINT', listener as NodeJS.SignalsListener);
    }
  }
}

/** Stream clone progress to stderr so stdout stays machine-readable. */
function writeProgress(progress: ProjectCreateProgress): void {
  if (progress.percent !== null) {
    process.stderr.write(`\r${progress.phase}: ${progress.percent}%`);
  } else {
    process.stderr.write(`\r${progress.phase}…`);
  }
}

/** Report a completed creation, including the metadata registration produced. */
function reportCreated(
  verb: string,
  result: { key: string; name: string; path: string; seededContextLayer: boolean; hooksInstalled: number },
): void {
  console.log(chalk.green(`✓ ${verb}: ${result.name}`));
  console.log(chalk.dim(`  Key: ${result.key}`));
  console.log(chalk.dim(`  Path: ${result.path}`));
  if (result.hooksInstalled > 0) {
    console.log(chalk.dim(`  Installed ${result.hooksInstalled} git hook(s) for branch protection`));
  }
  if (result.seededContextLayer) {
    console.log(chalk.dim('  Context layer: .overdeck/context/project.md (commit this)'));
  }
}

interface AddOptions {
  name?: string;
  type?: 'standalone' | 'monorepo';
  linearTeam?: string;
  rallyProject?: string;
  dryRun?: boolean;
}

export async function projectAddCommand(
  projectPath: string,
  options: AddOptions = {}
): Promise<void> {
  const fullPath = resolve(projectPath);

  if (!existsSync(fullPath)) {
    console.log(chalk.red(`Path does not exist: ${fullPath}`));
    return;
  }

  // Determine name/key from directory if not provided
  const name = options.name || fullPath.split('/').pop() || 'unknown';
  const key = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Try to detect Linear team from .pan/project.toml or package.json
  let linearTeam = options.linearTeam;
  if (!linearTeam) {
    const projectToml = join(fullPath, '.pan', 'project.toml');
    if (existsSync(projectToml)) {
      const content = readFileSync(projectToml, 'utf-8');
      const match = content.match(/team\s*=\s*"([^"]+)"/);
      if (match) linearTeam = match[1];
    }
  }

  // Step 1: Resolve intent (dry-run validation)
  const input: ProjectCreateInput = {
    mode: 'existing',
    path: fullPath,
    name: options.name,
    // A team read from .pan/project.toml may be lower case, and the prefix rule
    // is uppercase. Rejecting the add over that would regress a flag that has
    // always worked.
    issuePrefix: linearTeam ? linearTeam.toUpperCase() : undefined,
    homeBoundary: false, // CLI does not enforce home directory boundary
  };

  const intent = await resolveProjectCreateIntent(input);

  const alreadyHere = intent.findings.find((f) => f.code === 'project-exists-here');
  if (alreadyHere) {
    // Same folder, same key: this *is* the project, not a name collision, so
    // point at the two things the operator can actually do with it.
    console.log(chalk.yellow(`\nAlready registered as '${intent.registeredKeyAtPath}': ${intent.path}`));
    console.log(chalk.dim(`  Open it:   pan project show ${intent.registeredKeyAtPath}`));
    console.log(chalk.dim(`  Repair it: pan project finish-setup ${intent.registeredKeyAtPath}`));
    console.log('');
    return;
  }

  if (intent.findings.length > 0) {
    await reportFindingsAndExit(intent);
    return;
  }

  // Step 2: Dry run stops here having created nothing — no directory, no
  // registration, no context layer, no hooks.
  if (options.dryRun) {
    printDryRun(intent);
    return;
  }

  // Step 3: Perform the actual create
  let regResult: Awaited<ReturnType<typeof registerProjectFromPath>>;
  try {
    const result = await performProjectCreate(intent);
    // The real written config, not a stub: the spread below replaces the whole
    // entry, so a hand-built { name, path } would silently drop the detected
    // tracker, repo slug and default branch that registration just wrote.
    const written = getProjectSync(result.key);
    regResult = {
      key: result.key,
      config: written ?? { name: result.name, path: result.path },
      hooksInstalled: result.hooksInstalled,
      seededContextLayer: result.seededContextLayer,
    };
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      console.log(chalk.yellow(`Project already registered with key: ${err.key}`));
      console.log(chalk.dim(`Existing path: ${err.existingPath}`));
      console.log(chalk.dim(`To update, first run: pan project remove ${err.key}`));
      return;
    }
    if (err instanceof ProjectCreateFailureError) {
      await reportFailureAndExit(err.failure);
      return;
    }
    throw err;
  }

  // Apply CLI-only extras (linearTeam, rallyProject) to the already-written entry.
  if (linearTeam || options.rallyProject) {
    const { registerProjectSync } = await import('../../lib/projects.js');
    const updated: ProjectConfig = { ...regResult.config };
    if (linearTeam) updated.issue_prefix = linearTeam.toUpperCase();
    if (options.rallyProject) updated.rally_project = options.rallyProject;
    registerProjectSync(regResult.key, updated);
    regResult = { ...regResult, config: updated };
  }

  console.log(chalk.green(`✓ Added project: ${name}`));
  console.log(chalk.dim(`  Key: ${key}`));
  console.log(chalk.dim(`  Path: ${fullPath}`));
  if (regResult.seededContextLayer) {
    console.log(chalk.dim('  Context layer: .overdeck/context/project.md (commit this)'));
  }
  if (linearTeam) {
    console.log(chalk.dim(`  Linear team: ${linearTeam.toUpperCase()}`));
  }
  if (options.rallyProject) {
    console.log(chalk.dim(`  Rally project: ${options.rallyProject}`));
  }
  console.log('');

  // Check what the project has and guide them on next steps
  const hasDevcontainer = existsSync(join(fullPath, '.devcontainer'));
  const hasDevcontainerTemplate =
    existsSync(join(fullPath, 'infra', '.devcontainer-template')) ||
    existsSync(join(fullPath, '.devcontainer-template'));

  // Detect repo structure (monorepo vs polyrepo)
  const hasRootGit = existsSync(join(fullPath, '.git'));
  const subRepos: string[] = [];

  if (!hasRootGit) {
    const { readdirSync, statSync } = await import('fs');
    try {
      const entries = readdirSync(fullPath);
      for (const entry of entries) {
        const entryPath = join(fullPath, entry);
        try {
          if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, '.git'))) {
            subRepos.push(entry);
          }
        } catch {
          // Skip inaccessible directories
        }
      }
    } catch {
      // Could not scan directory
    }
  }

  const isPolyrepo = !hasRootGit && subRepos.length > 0;

  // Install git hooks for polyrepo sub-repos (single-repo case handled by registerProjectFromPath).
  let hooksInstalled = regResult.hooksInstalled;
  if (isPolyrepo) {
    for (const repo of subRepos) {
      hooksInstalled += installGitHooksInDir(join(fullPath, repo, '.git'));
    }
  }

  if (hasRootGit && regResult.hooksInstalled > 0) {
    console.log(chalk.green(`✓ Installed ${regResult.hooksInstalled} git hook(s) for branch protection`));
  } else if (isPolyrepo && hooksInstalled > 0) {
    console.log(chalk.green(`✓ Installed git hooks in ${subRepos.length} repositories`));
  }
  if (hooksInstalled > 0) {
    console.log(chalk.dim('  (Prevents agents from checking out branches in main project)'));
    console.log('');
  }

  console.log(chalk.bold('Next Steps:\n'));

  // Step 0: Polyrepo detected - highlight this
  if (isPolyrepo) {
    console.log(chalk.yellow.bold('⚠️  POLYREPO DETECTED'));
    console.log(chalk.yellow(`   Found ${subRepos.length} git repositories: ${subRepos.join(', ')}`));
    console.log('');
    console.log(chalk.cyan('0. Configure as polyrepo'));
    console.log(chalk.dim(`   Edit ${PROJECTS_CONFIG_FILE} and add:`));
    console.log('');
    console.log(chalk.dim('   workspace:'));
    console.log(chalk.dim('     type: polyrepo'));
    console.log(chalk.dim('     workspaces_dir: workspaces'));
    console.log(chalk.dim('     default_branch: main'));
    console.log(chalk.dim('     repos:'));
    for (const repo of subRepos) {
      console.log(chalk.dim(`       - name: ${repo}`));
      console.log(chalk.dim(`         path: ${repo}`));
      console.log(chalk.dim(`         branch_prefix: "feature/"`));
    }
    console.log('');
    console.log(chalk.dim('   See README "Polyrepo Workspace Configuration" for full example.'));
    console.log('');
  }

  // Step 1: Configure workspace in projects.yaml
  console.log(chalk.cyan(`${isPolyrepo ? '1' : '1'}. Configure workspace settings`));
  console.log(chalk.dim(`   Edit ${PROJECTS_CONFIG_FILE}`));
  console.log(chalk.dim('   Add workspace, dns, docker, and service configuration'));
  console.log('');

  // Step 2: Create templates if needed
  if (!hasDevcontainerTemplate && !hasDevcontainer) {
    console.log(chalk.cyan('2. Create workspace templates (for Docker-based workspaces)'));
    console.log(chalk.dim('   Your project needs:'));
    console.log(chalk.dim('   • infra/.devcontainer-template/docker-compose.devcontainer.yml.template'));
    console.log(chalk.dim('   • infra/.devcontainer-template/Dockerfile'));
    console.log(chalk.dim('   See README "What Your Project Needs to Provide" section'));
    console.log('');
  } else {
    console.log(chalk.green('✓ Found existing container templates'));
    console.log('');
  }

  // Step 3: Sync and test
  console.log(chalk.cyan(`${hasDevcontainerTemplate || hasDevcontainer ? '2' : '3'}. Test workspace creation`));
  console.log(chalk.dim('   pan workspace create TEST-123'));
  console.log(chalk.dim('   pan workspace destroy TEST-123'));
  console.log('');

  // Documentation reference
  console.log(chalk.dim('Documentation: https://github.com/eltmon/overdeck#what-your-project-needs-to-provide'));
}

interface CloneOptions {
  parent?: string;
  name?: string;
  issuePrefix?: string;
  dryRun?: boolean;
}

export async function projectCloneCommand(
  url: string,
  options: CloneOptions = {}
): Promise<void> {
  // Step 1: Resolve intent with network probe
  const input: ProjectCreateInput = {
    mode: 'clone',
    url,
    parentDir: options.parent,
    name: options.name,
    issuePrefix: options.issuePrefix,
    homeBoundary: false, // CLI does not enforce home directory boundary
    refreshRemote: true,
  };

  const intent = await resolveProjectCreateIntent(input);

  if (intent.findings.length > 0) {
    await reportFindingsAndExit(intent);
    return;
  }

  // Dry run stops here having cloned nothing and written nothing.
  if (options.dryRun) {
    printDryRun(intent);
    return;
  }

  // Step 3: Perform the actual clone
  console.log('');
  try {
    const result = await withInterruptibleClone((signal) =>
      performProjectCreate(intent, { onProgress: writeProgress, signal }),
    );

    process.stderr.write('\n');
    reportCreated('Cloned and registered', result);
    console.log('');
  } catch (err) {
    process.stderr.write('\n');
    if (err instanceof DuplicateProjectError) {
      console.log(chalk.yellow(`Project already registered with key: ${err.key}`));
      console.log(chalk.dim(`Existing path: ${err.existingPath}`));
      console.log(chalk.dim(`To update, first run: pan project remove ${err.key}`));
      return;
    }
    if (err instanceof ProjectCreateFailureError) {
      await reportFailureAndExit(err.failure);
      return;
    }
    throw err;
  }
}

interface FinishSetupOptions {
  path?: string;
}

/**
 * Repair a registered project whose setup did not finish.
 *
 * A thin wrapper over the shared idempotent helper: it never clones and never
 * registers, so running it against an already-complete project is a no-op that
 * reports the same result.
 */
export async function projectFinishSetupCommand(
  key: string,
  options: FinishSetupOptions = {},
): Promise<void> {
  const config = getProjectSync(key);
  if (!config) {
    console.error(chalk.red(`No project registered under '${key}'.`));
    await exitCli(1);
    return;
  }

  // `--path` is a consistency check, not a relocation: repairing the wrong
  // project is worse than refusing to repair anything.
  const expectedPath = options.path ? resolve(options.path) : config.path;

  try {
    const result = await finishProjectSetup({ key, expectedPath });
    console.log('');
    console.log(chalk.green(`✓ Setup complete: ${result.name}`));
    console.log(chalk.dim(`  Key: ${result.key}`));
    console.log(chalk.dim(`  Path: ${result.path}`));
    console.log(chalk.dim(`  Main workspace: ${result.mainWorkspaceId}`));
    console.log('');
  } catch (err) {
    if (err instanceof ProjectCreateFailureError) {
      await reportFailureAndExit(err.failure);
      return;
    }
    throw err;
  }
}

interface ListOptions {
  json?: boolean;
}

export async function projectListCommand(options: ListOptions = {}): Promise<void> {
  const projects = listProjectsSync();

  if (projects.length === 0) {
    console.log(chalk.dim('No projects registered.'));
    console.log(chalk.dim('Add one with: pan projects add <path> --linear-team <TEAM>'));
    console.log(chalk.dim(`Or edit: ${PROJECTS_CONFIG_FILE}`));
    return;
  }

  if (options.json) {
    const output: Record<string, ProjectConfig> = {};
    for (const { key, config } of projects) {
      output[key] = config;
    }
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(chalk.bold('\nRegistered Projects:\n'));

  for (const { key, config } of projects) {
    const exists = existsSync(config.path);
    const statusIcon = exists ? chalk.green('✓') : chalk.red('✗');

    console.log(`${statusIcon} ${chalk.bold(config.name)} ${chalk.dim(`(${key})`)}`);
    console.log(`  ${chalk.dim(config.path)}`);
    if (getIssuePrefix(config)) {
      console.log(`  ${chalk.cyan(`Linear: ${getIssuePrefix(config)}`)}`);
    }
    if (config.rally_project) {
      console.log(`  ${chalk.cyan(`Rally: ${config.rally_project}`)}`);
    }
    if (config.issue_routing && config.issue_routing.length > 0) {
      console.log(`  ${chalk.dim(`Routes: ${config.issue_routing.length} rules`)}`);
    }
    console.log('');
  }

  console.log(chalk.dim(`Config: ${PROJECTS_CONFIG_FILE}`));
}

export async function projectRenameCommand(key: string, newName: string): Promise<void> {
  try {
    const project = getProjectSync(key);
    if (!project) throw new Error(`Unknown project: ${key}`);

    const oldName = project.name;
    renameProjectSync(key, newName);
    console.log(chalk.green(`✓ Renamed project: ${oldName} → ${newName.trim()}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(message));
    process.exitCode = 1;
  }
}

export async function projectRemoveCommand(nameOrPath: string): Promise<void> {
  // Try to find by key first, then by name, then by path
  const projects = listProjectsSync();

  // Try direct key match
  if (unregisterProjectSync(nameOrPath)) {
    console.log(chalk.green(`✓ Removed project: ${nameOrPath}`));
    return;
  }

  // Try to find by name or path
  for (const { key, config } of projects) {
    if (config.name === nameOrPath || config.path === resolve(nameOrPath)) {
      unregisterProjectSync(key);
      console.log(chalk.green(`✓ Removed project: ${config.name}`));
      return;
    }
  }

  console.log(chalk.red(`Project not found: ${nameOrPath}`));
  console.log(chalk.dim(`Use 'pan projects list' to see registered projects.`));
}

export async function projectInitCommand(): Promise<void> {
  if (existsSync(PROJECTS_CONFIG_FILE)) {
    console.log(chalk.yellow(`Config already exists: ${PROJECTS_CONFIG_FILE}`));
    return;
  }

  initializeProjectsConfigSync();

  console.log(chalk.green('✓ Projects config initialized'));
  console.log('');
  console.log(chalk.dim(`Edit ${PROJECTS_CONFIG_FILE} to add your projects.`));
  console.log('');
  console.log(chalk.bold('Quick start:'));
  console.log(
    chalk.dim(
      '  pan projects add /path/to/project --name "My Project" --linear-team MIN'
    )
  );
}

export async function projectShowCommand(keyOrName: string): Promise<void> {
  const projects = listProjectsSync();

  // Find by key or name
  let found = getProjectSync(keyOrName);
  let foundKey = keyOrName;

  if (!found) {
    for (const { key, config } of projects) {
      if (config.name.toLowerCase() === keyOrName.toLowerCase()) {
        found = config;
        foundKey = key;
        break;
      }
    }
  }

  if (!found) {
    console.error(chalk.red(`Project not found: ${keyOrName}`));
    console.log(chalk.dim(`Use 'pan projects list' to see registered projects.`));
    return exitCli(1);
  }

  const pathExists = existsSync(found.path);
  const pathStatus = pathExists ? chalk.green('✓') : chalk.red('✗');

  console.log(chalk.bold(`\nProject: ${foundKey}\n`));
  console.log(`  Name:   ${found.name}`);
  console.log(`  Path:   ${pathStatus} ${found.path}`);
  if (getIssuePrefix(found)) {
    console.log(`  Team:   ${getIssuePrefix(found)}`);
  }
  if (found.rally_project) {
    console.log(`  Rally:  ${found.rally_project}`);
  }

  if (found.issue_routing && found.issue_routing.length > 0) {
    console.log('\n  ' + chalk.bold('Routing Rules:'));
    for (const rule of found.issue_routing) {
      if (rule.labels) {
        console.log(`    Labels: ${rule.labels.join(', ')}`);
        console.log(`      → ${rule.path}`);
      } else if (rule.default) {
        console.log(`    Default:`);
        console.log(`      → ${rule.path}`);
      }
    }
  }

  console.log('');
}

interface AddTargetOptions {
  path?: string;
  primary?: boolean;
}

export async function projectAddTargetCommand(key: string, options: AddTargetOptions): Promise<void> {
  if (!options.path) {
    console.log(chalk.red('--path is required'));
    return exitCli(1);
  }

  const config = getProjectSync(key);
  if (!config) {
    console.log(chalk.red(`No project registered with key '${key}'`));
    return exitCli(1);
  }

  const targetPath = resolve(options.path);
  upsertProjectFromConfig(key, config);
  addProjectTarget(key, targetPath, options.primary ?? false);

  console.log(chalk.green(`✓ Added target '${targetPath}' to project '${key}'${options.primary ? ' (primary)' : ''}`));
}

export function registerProjectCommands(command: Command): void {
  command
    .command('add <path>')
    .description('Register a project with Overdeck')
    .option('--name <name>', 'Project name')
    .option('--type <type>', 'Project type (standalone/monorepo)', 'standalone')
    .option('--linear-team <team>', 'Linear team prefix (e.g., MIN, PAN)')
    .option('--rally-project <oid>', 'Rally project OID (e.g., /project/822404704163)')
    .option('--dry-run', 'Validate without creating (resolve-before-create pattern)')
    .action(projectAddCommand);

  command
    .command('clone <url>')
    .description('Clone a GitHub or GitLab repository and register it as a project')
    .option('--parent <dir>', 'Parent directory (default: ~/Projects)')
    .option('--name <name>', 'Project name (default: repository name)')
    .option('--issue-prefix <prefix>', 'Issue prefix (default: derived from the name)')
    .option('--dry-run', 'Print the resolved intent as JSON and create nothing')
    .action(projectCloneCommand);

  command
    .command('finish-setup <key>')
    .description('Finish setup for a registered project whose creation did not complete')
    .option('--path <path>', 'Expected project path; refuses if it does not match the registration')
    .action(projectFinishSetupCommand);

  command
    .command('list')
    .description('List all registered projects')
    .option('--json', 'Output as JSON')
    .action(projectListCommand);

  command
    .command('show <key>')
    .description('Show details for a specific project')
    .action(projectShowCommand);

  command
    .command('rename <key> <newName>')
    .description('Rename a project\'s display name (the registration key stays unchanged)')
    .action(projectRenameCommand);

  command
    .command('remove <nameOrPath>')
    .description('Remove a project from the registry')
    .action(projectRemoveCommand);

  command
    .command('init')
    .description('Initialize projects.yaml with example configuration')
    .action(projectInitCommand);

  command
    .command('add-target <project>')
    .description('Add a secondary target path for a registered project')
    .option('--path <path>', 'Target path to add')
    .option('--primary', 'Make this the primary target (demotes any existing primary)')
    .action(projectAddTargetCommand);
}
