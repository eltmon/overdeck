/**
 * `pan spawn` — put a worker pane on one xBRIEF item (PAN-3917 FR-14).
 *
 * The foreman (the issue's `work` pane) calls this to dispatch a cross-family
 * worker. The pane is created through the terminal backend, inside the issue's
 * workspace, stamped with the FR-5 metadata tokens `{issue, role: 'worker',
 * harness, model}` so the issue tree renders it under its issue.
 *
 * Every worker gets its own worktree under `<workspace>/.swarm/<item>/` on the
 * branch `<feature-branch>-<item>`, so two workers never share a working tree.
 * It commits there and hands back; the foreman integrates, pushes and runs
 * `pan task done` (PAN-4340). `--shared` (foreman or operator only) runs the
 * worker in the workspace itself, for strictly serial use.
 *
 * Nothing about the pane is persisted: the backend is the owner of session
 * liveness and is read live.
 *
 * The pane's `OVERDECK_CLAIM_ID` is its agent name (PAN-4339 FR-7), so
 * `pan task claim` records a claimant id that liveness can actually probe,
 * rather than the exited `pan spawn` CLI process's own pid.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import chalk from 'chalk';
import type { Command } from 'commander';
import { Effect } from 'effect';
import { EFFORT_LEVELS, type EffortLevel } from '@overdeck/contracts';

import { exitCli } from '../exit.js';
import { resolveIssueId } from '../../lib/issue-id.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { readWorkspacePlanSync } from '../../lib/xbrief/io.js';
import { createItemWorktree } from '../../lib/workspaces/item-worktree.js';
import { resolveEffort, InvalidEffortError, type EffortConfigSlice } from '../../lib/agents/resolve-effort.js';
import type { RuntimeName } from '../../lib/runtimes/types.js';
// launch.js registers both adapters at import time and owns the one backend
// resolution (policy + Herdr availability probe, PAN-3956).
import { resolveLaunchBackend } from '../../lib/terminal-backends/launch.js';
import {
  isUnsupported,
  type AgentPaneRef,
  type TerminalBackend,
} from '../../lib/terminal-backends/types.js';

export interface SpawnOptions {
  issue?: string;
  item?: string;
  model?: string;
  harness?: string;
  shared?: boolean;
  effort?: string;
}

export interface SpawnDeps {
  /** Resolve the backend to spawn through. Injected by the test. */
  readonly resolveBackend?: () => Promise<TerminalBackend>;
  /** Create the item worktree. Injected by the test. */
  readonly createWorktree?: (workspacePath: string, itemId: string) => Promise<string>;
  /** The caller's environment. Injected by the test. */
  readonly env?: NodeJS.ProcessEnv;
  /** Pre-loaded effort config slice. Injected by the test so resolution never reads the developer's live config. */
  readonly effortConfig?: EffortConfigSlice;
}

/**
 * The argv flags that make a harness launch at the resolved effort. Only
 * claude-code and codex have a mapping (#4511: pan spawn builds its pane
 * argv without a harness binary, so an unmapped harness just launches
 * without an effort flag rather than failing).
 */
export function spawnWorkerEffortArgs(harness: string, effort: EffortLevel): string[] {
  if (harness === 'claude-code') return ['--effort', effort];
  if (harness === 'codex') return ['-c', `model_reasoning_effort=${effort}`];
  console.error(chalk.yellow(`pan spawn: harness '${harness}' has no --effort mapping; launching without one.`));
  return [];
}

/**
 * The same resolution every launcher uses: an unavailable Herdr is a
 * `TerminalBackendUnavailableError` naming `pan install`, not a raw socket error.
 */
async function defaultResolveBackend(): Promise<TerminalBackend> {
  return resolveLaunchBackend();
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

  const env = deps.env ?? process.env;
  if (options.shared && env.OVERDECK_ITEM_ID) {
    console.error(chalk.red(
      '--shared is for the foreman or an operator: a pan spawn worker cannot put another worker in the shared workspace.',
    ));
    return exitCli(1);
  }

  const issueId = resolveIssueId(options.issue);
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

  let workerEffort: ReturnType<typeof resolveEffort>;
  try {
    workerEffort = resolveEffort({
      explicit: options.effort,
      itemEffort: item.metadata?.effort,
      planEffort: doc?.plan.metadata?.effort,
      role: 'worker',
      issueId,
      model: options.model,
      harness: harness as RuntimeName,
      config: deps.effortConfig,
    });
  } catch (error) {
    if (error instanceof InvalidEffortError) {
      console.error(chalk.red(`Unknown --effort ${options.effort}; expected one of ${EFFORT_LEVELS.join(', ')}.`));
      return exitCli(1);
    }
    throw error;
  }
  if (workerEffort.warning) console.warn(chalk.yellow(workerEffort.warning));

  const cwd = options.shared
    ? workspacePath
    : await (deps.createWorktree ?? createItemWorktree)(workspacePath, item.id);

  const backend = await (deps.resolveBackend ?? defaultResolveBackend)();

  const workspace = await Effect.runPromise(backend.workspaceFor(issueId, workspacePath));
  if (isUnsupported(workspace)) {
    console.error(chalk.red(`The ${backend.name} backend cannot host ${issueId}'s workspace: ${workspace.reason}`));
    return exitCli(1);
  }

  // PAN-3905: an item worktree is a fresh directory Claude Code has never
  // seen; trust it before launch or the worker stops at the trust dialog.
  // This path calls the backend directly, not launchAgentPane, so it does it
  // itself.
  if (harness === 'claude-code') {
    try {
      const { preTrustDirectory } = await import('../../lib/workspace-manager/worktree-ops.js');
      await preTrustDirectory(cwd);
    } catch {
      // Non-fatal: the worker still starts and the prompt is visible.
    }
  }

  const agentName = `${issueId.toLowerCase()}-${item.id}`;
  const pane = await Effect.runPromise(
    backend.startAgent(workspace, {
      kind: harness,
      argv: ['--model', options.model, ...spawnWorkerEffortArgs(harness, workerEffort.effort)],
      env: { OVERDECK_ISSUE_ID: issueId, OVERDECK_ITEM_ID: item.id, OVERDECK_CLAIM_ID: agentName },
      tokens: { issue: issueId, role: 'worker', harness, model: options.model },
      name: agentName,
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
    .description('Create a worker pane for one xBRIEF item in its own item worktree')
    .requiredOption('--issue <id>', 'Issue the worker belongs to')
    .requiredOption('--item <item>', 'xBRIEF item the worker takes')
    .requiredOption('--model <model>', 'Model the worker runs on')
    .option('--harness <harness>', 'Coding-agent harness (default: claude-code)')
    .option('--effort <level>', 'Reasoning effort: low | medium | high | xhigh | max (defaults to the item/plan metadata, then roles.worker.effort)')
    .option('--shared', 'Run the worker in the issue workspace instead of an item worktree (foreman/operator only; serial use)')
    .action(async (options: SpawnOptions) => spawnCommand(options));
}
