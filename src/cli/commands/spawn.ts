/**
 * `pan spawn` — put a worker pane on one xBRIEF item (PAN-3917 FR-14).
 *
 * The foreman (the issue's `work` pane) calls this to dispatch a cross-family
 * worker. The pane is created through the terminal backend, inside the issue's
 * workspace, stamped with the FR-5 metadata tokens `{issue, role: 'worker',
 * harness, model}` so the issue tree renders it under its issue.
 *
 * An item that declares a `files_scope` gets its own worktree under
 * `<workspace>/.swarm/<item>/` so two workers never share a working tree; an
 * item without one runs in the workspace itself.
 *
 * Nothing about the pane is persisted: the backend is the owner of session
 * liveness and is read live.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import chalk from 'chalk';
import type { Command } from 'commander';
import { Effect } from 'effect';

import { exitCli } from '../exit.js';
import { resolveIssueIdSync } from '../../lib/issue-id.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { readWorkspacePlanSync } from '../../lib/xbrief/io.js';
// launch.js registers both adapters at import time and owns the one backend
// resolution (policy + Herdr availability probe, PAN-3956).
import { resolveLaunchBackend } from '../../lib/terminal-backends/launch.js';
import {
  isUnsupported,
  type AgentPaneRef,
  type TerminalBackend,
} from '../../lib/terminal-backends/types.js';

const execFileAsync = promisify(execFile);

export interface SpawnOptions {
  issue?: string;
  item?: string;
  model?: string;
  harness?: string;
}

export interface SpawnDeps {
  /** Resolve the backend to spawn through. Injected by the test. */
  readonly resolveBackend?: () => Promise<TerminalBackend>;
  /** Create the item worktree. Injected by the test. */
  readonly createWorktree?: (workspacePath: string, itemId: string) => Promise<string>;
}

/**
 * The same resolution every launcher uses: an unavailable Herdr is a
 * `TerminalBackendUnavailableError` naming `pan install`, not a raw socket error.
 */
async function defaultResolveBackend(): Promise<TerminalBackend> {
  return resolveLaunchBackend();
}

/**
 * `<workspace>/.swarm/<item>/` as a git worktree on its own item branch, cut
 * from the issue's feature branch. The branch matters: a detached worktree
 * orphans everything the worker commits. An existing worktree is reused.
 * Async git only.
 */
async function defaultCreateWorktree(workspacePath: string, itemId: string): Promise<string> {
  const path = join(workspacePath, '.swarm', itemId);
  if (existsSync(path)) return path;

  const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath });
  const featureBranch = stdout.trim();
  const itemBranch = `${featureBranch}/${itemId}`;

  const branchExists = await execFileAsync(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/heads/${itemBranch}`],
    { cwd: workspacePath },
  ).then(() => true, () => false);

  await execFileAsync(
    'git',
    branchExists
      ? ['worktree', 'add', path, itemBranch]
      : ['worktree', 'add', '-b', itemBranch, path, featureBranch],
    { cwd: workspacePath },
  );
  return path;
}

export async function spawnCommand(options: SpawnOptions, deps: SpawnDeps = {}): Promise<void> {
  if (!options.issue) {
    console.error(chalk.red('--issue is required.'));
    return exitCli(1);
  }
  if (!options.item) {
    console.error(chalk.red('--item is required: pan spawn puts one worker on one xBRIEF item.'));
    return exitCli(1);
  }
  if (!options.model) {
    console.error(chalk.red('--model is required: the foreman picks the worker model.'));
    return exitCli(1);
  }

  const issueId = resolveIssueIdSync(options.issue);
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved?.projectPath) {
    console.error(chalk.red(`Could not resolve a registered project for ${issueId}.`));
    return exitCli(1);
  }

  const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  if (!existsSync(workspacePath)) {
    console.error(chalk.red(`${issueId} has no workspace at ${workspacePath}. Run pan start ${issueId} first.`));
    return exitCli(1);
  }

  const doc = readWorkspacePlanSync(workspacePath);
  const item = doc?.plan.items.find(({ id }) => id === options.item);
  if (!item) {
    console.error(chalk.red(`${options.item} is not an item of ${issueId}'s xBRIEF.`));
    return exitCli(1);
  }

  const harness = options.harness ?? 'claude-code';
  const filesScope = item.metadata?.files_scope;
  const cwd = filesScope?.length
    ? await (deps.createWorktree ?? defaultCreateWorktree)(workspacePath, item.id)
    : workspacePath;

  const backend = await (deps.resolveBackend ?? defaultResolveBackend)();

  const workspace = await Effect.runPromise(backend.workspaceFor(issueId, workspacePath));
  if (isUnsupported(workspace)) {
    console.error(chalk.red(`The ${backend.name} backend cannot host ${issueId}'s workspace: ${workspace.reason}`));
    return exitCli(1);
  }

  const pane = await Effect.runPromise(
    backend.startAgent(workspace, {
      kind: harness,
      argv: ['--model', options.model],
      env: { OVERDECK_ISSUE_ID: issueId, OVERDECK_ITEM_ID: item.id },
      tokens: { issue: issueId, role: 'worker', harness, model: options.model },
      name: `${issueId.toLowerCase()}-${item.id}`,
      cwd,
    }),
  );
  if (isUnsupported(pane)) {
    console.error(chalk.red(`The ${backend.name} backend could not start the worker: ${pane.reason}`));
    return exitCli(1);
  }

  console.log((pane as AgentPaneRef).paneId);
}

export function registerSpawnCommand(program: Command): void {
  program
    .command('spawn')
    .description('Create a worker pane for one xBRIEF item in the issue workspace')
    .requiredOption('--issue <id>', 'Issue the worker belongs to')
    .requiredOption('--item <item>', 'xBRIEF item the worker takes')
    .requiredOption('--model <model>', 'Model the worker runs on')
    .option('--harness <harness>', 'Coding-agent harness (default: claude-code)')
    .action(async (options: SpawnOptions) => spawnCommand(options));
}
