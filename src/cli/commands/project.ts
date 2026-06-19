import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  listProjectsSync,
  unregisterProjectSync,
  getProjectSync,
  initializeProjectsConfigSync,
  PROJECTS_CONFIG_FILE,
  ProjectConfig,
  IssueRoutingRule,
  getIssuePrefix,
} from '../../lib/projects.js';
import { registerProjectFromPath, installGitHooksInDir, DuplicateProjectError } from '../../lib/project-registration.js';

interface AddOptions {
  name?: string;
  type?: 'standalone' | 'monorepo';
  linearTeam?: string;
  rallyProject?: string;
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

  let regResult: Awaited<ReturnType<typeof registerProjectFromPath>>;
  try {
    regResult = await registerProjectFromPath({ path: fullPath, name });
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      console.log(chalk.yellow(`Project already registered with key: ${err.key}`));
      console.log(chalk.dim(`Existing path: ${err.existingPath}`));
      console.log(chalk.dim(`To update, first run: pan projects remove ${err.key}`));
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
    console.log(chalk.dim('  Context layer: .pan/context/project.md (commit this)'));
  }
  if (linearTeam) {
    console.log(chalk.dim(`  Linear team: ${linearTeam}`));
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
    process.exit(1);
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
