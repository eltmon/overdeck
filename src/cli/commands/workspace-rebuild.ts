import { execFile } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { promisify } from 'util';
import { dirname, join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { ensureDevcontainer } from '../../lib/workspace/ensure-devcontainer.js';
import { getProject, resolveProjectFromIssue } from '../../lib/projects.js';

const execFileAsync = promisify(execFile);

const COMPOSE_FILES = [
  'docker-compose.devcontainer.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

export function composeProjectNameForWorkspace(workspacePath: string, issueId: string): string {
  const featureFolder = `feature-${issueId.toLowerCase()}`;
  for (const devPath of [join(workspacePath, '.devcontainer', 'dev'), join(workspacePath, 'dev')]) {
    if (!existsSync(devPath)) continue;
    try {
      const content = readFileSync(devPath, 'utf-8');
      const match = content.match(/COMPOSE_PROJECT_NAME="([^$"]*)\$\{FEATURE_FOLDER\}"/);
      if (match) return `${match[1]}${featureFolder}`;
      const literalMatch = content.match(/COMPOSE_PROJECT_NAME="([^"]+)"/);
      if (literalMatch) return literalMatch[1];
    } catch {}
  }
  return `panopticon-${featureFolder}`;
}

function findDevcontainerComposeFile(workspacePath: string): string | null {
  const devcontainerDir = join(workspacePath, '.devcontainer');
  for (const file of COMPOSE_FILES) {
    const fullPath = join(devcontainerDir, file);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

async function dockerCompose(args: string[], cwd: string): Promise<void> {
  await execFileAsync('docker', ['compose', ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function workspaceRebuildCommand(issueId: string): Promise<void> {
  const normalizedIssueId = issueId.toLowerCase();
  const resolvedProject = resolveProjectFromIssue(issueId);
  const projectConfig = resolvedProject ? getProject(resolvedProject.projectKey) : null;
  if (!resolvedProject || !projectConfig) {
    console.error(chalk.red(`✗ No project found for issue ${issueId}`));
    process.exit(1);
  }

  if (!projectConfig.workspace?.docker?.compose_template) {
    console.error(chalk.red(`✗ Project ${projectConfig.name} has no workspace docker compose_template configured`));
    process.exit(1);
  }

  const workspacePath = join(resolvedProject.projectPath, 'workspaces', `feature-${normalizedIssueId}`);
  if (!existsSync(workspacePath)) {
    console.error(chalk.red(`✗ Workspace not found: ${workspacePath}`));
    process.exit(1);
  }

  const spinner = ora(`Rebuilding workspace stack for ${issueId.toUpperCase()}...`).start();
  try {
    const composeProjectName = composeProjectNameForWorkspace(workspacePath, normalizedIssueId);
    const existingComposeFile = findDevcontainerComposeFile(workspacePath);
    if (existingComposeFile) {
      spinner.text = 'Tearing down existing workspace stack...';
      await dockerCompose([
        '-f',
        existingComposeFile,
        '-p',
        composeProjectName,
        'down',
        '-v',
        '--remove-orphans',
      ], dirname(existingComposeFile));
    }

    spinner.text = 'Re-rendering .devcontainer/ from template...';
    const devcontainerDir = join(workspacePath, '.devcontainer');
    if (existsSync(devcontainerDir)) {
      rmSync(devcontainerDir, { recursive: true, force: true });
    }
    const ensured = ensureDevcontainer({ workspacePath, issueId: normalizedIssueId });
    if (!ensured.step.success) {
      throw new Error(ensured.step.error ?? 'Failed to render .devcontainer/');
    }

    const composeFile = findDevcontainerComposeFile(workspacePath);
    if (!composeFile) {
      throw new Error(`No devcontainer compose file found in ${devcontainerDir}`);
    }

    spinner.text = 'Starting workspace stack...';
    await dockerCompose([
      '-f',
      composeFile,
      '-p',
      composeProjectName,
      'up',
      '-d',
      '--build',
    ], dirname(composeFile));

    spinner.succeed(`Workspace stack rebuilt for ${issueId.toUpperCase()}`);
    console.log(chalk.dim(`  workspace: ${workspacePath}`));
    console.log(chalk.dim(`  compose:   ${composeFile}`));
    console.log(chalk.dim(`  project:   ${composeProjectName}`));
  } catch (error: any) {
    spinner.fail(`Workspace rebuild failed: ${error.message ?? error}`);
    process.exit(1);
  }
}
