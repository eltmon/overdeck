import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  listProjects,
  registerProject,
  unregisterProject,
  getProject,
  initializeProjectsConfig,
  PROJECTS_CONFIG_FILE,
  ProjectConfig,
  IssueRoutingRule,
} from '../../lib/projects.js';

interface AddOptions {
  name?: string;
  type?: 'standalone' | 'monorepo';
  linearTeam?: string;
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

  // Check if already registered
  const existing = getProject(key);
  if (existing) {
    console.log(chalk.yellow(`Project already registered with key: ${key}`));
    console.log(chalk.dim(`Existing path: ${existing.path}`));
    console.log(chalk.dim(`To update, first run: pan project remove ${key}`));
    return;
  }

  // Try to detect Linear team from .panopticon/project.toml or package.json
  let linearTeam = options.linearTeam;
  if (!linearTeam) {
    const projectToml = join(fullPath, '.panopticon', 'project.toml');
    if (existsSync(projectToml)) {
      const content = readFileSync(projectToml, 'utf-8');
      const match = content.match(/team\s*=\s*"([^"]+)"/);
      if (match) linearTeam = match[1];
    }
  }

  const projectConfig: ProjectConfig = {
    name,
    path: fullPath,
  };

  if (linearTeam) {
    projectConfig.linear_team = linearTeam.toUpperCase();
  }

  registerProject(key, projectConfig);

  console.log(chalk.green(`✓ Added project: ${name}`));
  console.log(chalk.dim(`  Key: ${key}`));
  console.log(chalk.dim(`  Path: ${fullPath}`));
  if (linearTeam) {
    console.log(chalk.dim(`  Linear team: ${linearTeam}`));
  }
  console.log('');
  console.log(chalk.dim(`Edit ${PROJECTS_CONFIG_FILE} to add issue routing rules.`));
}

interface ListOptions {
  json?: boolean;
}

export async function projectListCommand(options: ListOptions = {}): Promise<void> {
  const projects = listProjects();

  if (projects.length === 0) {
    console.log(chalk.dim('No projects registered.'));
    console.log(chalk.dim('Add one with: pan project add <path> --linear-team <TEAM>'));
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
    if (config.linear_team) {
      console.log(`  ${chalk.cyan(`Linear: ${config.linear_team}`)}`);
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
  const projects = listProjects();

  // Try direct key match
  if (unregisterProject(nameOrPath)) {
    console.log(chalk.green(`✓ Removed project: ${nameOrPath}`));
    return;
  }

  // Try to find by name or path
  for (const { key, config } of projects) {
    if (config.name === nameOrPath || config.path === resolve(nameOrPath)) {
      unregisterProject(key);
      console.log(chalk.green(`✓ Removed project: ${config.name}`));
      return;
    }
  }

  console.log(chalk.red(`Project not found: ${nameOrPath}`));
  console.log(chalk.dim(`Use 'pan project list' to see registered projects.`));
}

export async function projectInitCommand(): Promise<void> {
  if (existsSync(PROJECTS_CONFIG_FILE)) {
    console.log(chalk.yellow(`Config already exists: ${PROJECTS_CONFIG_FILE}`));
    return;
  }

  initializeProjectsConfig();

  console.log(chalk.green('✓ Projects config initialized'));
  console.log('');
  console.log(chalk.dim(`Edit ${PROJECTS_CONFIG_FILE} to add your projects.`));
  console.log('');
  console.log(chalk.bold('Quick start:'));
  console.log(
    chalk.dim(
      '  pan project add /path/to/project --name "My Project" --linear-team MIN'
    )
  );
}

export async function projectShowCommand(keyOrName: string): Promise<void> {
  const projects = listProjects();

  // Find by key or name
  let found = getProject(keyOrName);
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
    console.log(chalk.dim(`Use 'pan project list' to see registered projects.`));
    process.exit(1);
  }

  const pathExists = existsSync(found.path);
  const pathStatus = pathExists ? chalk.green('✓') : chalk.red('✗');

  console.log(chalk.bold(`\nProject: ${foundKey}\n`));
  console.log(`  Name:   ${found.name}`);
  console.log(`  Path:   ${pathStatus} ${found.path}`);
  if (found.linear_team) {
    console.log(`  Team:   ${found.linear_team}`);
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
