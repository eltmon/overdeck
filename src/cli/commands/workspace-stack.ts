/**
 * PAN-5250 FR-11, FR-12: `pan workspace up`, `pin` and `unpin`.
 *
 * `up` runs the wake door: the restore of any open reclaim (idle stop or
 * memory reclaim), then every other exited container of the workspace's
 * compose project whose service is wakeable. `pin` writes
 * `<workspace>/.overdeck/stack-pin.json`, which holds both the idle stop and
 * the memory reclaim off the workspace; `unpin` removes it.
 */
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import ora from 'ora';

import { tryComposeProjectNameForWorkspace } from '../../lib/workspace/stack-health.js';
import {
  removeStackPin,
  wakeableServicesForIssue,
  workspacePathForIssue,
  writeStackPin,
} from '../../lib/workspace/stack-idle-config.js';
import { listComposeContainers, type ComposeContainer } from '../../lib/workspace/stack-reclaim-docker.js';
import { wakeWorkspaceStack } from '../../lib/workspace/stack-restore.js';
import { exitCli } from '../exit.js';

interface Spinner {
  succeed: (text?: string) => unknown;
  fail: (text?: string) => unknown;
  stop: () => unknown;
}

export interface WorkspaceStackCliDeps {
  workspacePathFor: (issueId: string) => string | null;
  pathExists: (path: string) => boolean;
  wake: typeof wakeWorkspaceStack;
  writePin: (workspacePath: string, now: Date) => void;
  removePin: (workspacePath: string) => boolean;
  listContainers: () => Promise<ComposeContainer[] | null>;
  composeProjectFor: (workspacePath: string, issueId: string) => string | null;
  wakeableServices: (issueId: string) => ReadonlySet<string>;
  spinner: (text: string) => Spinner;
  log: (line: string) => void;
  exit: (code: number) => Promise<never>;
  now: () => Date;
}

function resolveDeps(deps: Partial<WorkspaceStackCliDeps> = {}): WorkspaceStackCliDeps {
  return {
    workspacePathFor: deps.workspacePathFor ?? workspacePathForIssue,
    pathExists: deps.pathExists ?? existsSync,
    wake: deps.wake ?? wakeWorkspaceStack,
    writePin: deps.writePin ?? writeStackPin,
    removePin: deps.removePin ?? removeStackPin,
    listContainers: deps.listContainers ?? (() => listComposeContainers({ all: true })),
    composeProjectFor: deps.composeProjectFor ?? tryComposeProjectNameForWorkspace,
    wakeableServices: deps.wakeableServices ?? wakeableServicesForIssue,
    spinner: deps.spinner ?? ((text) => ora(text).start()),
    log: deps.log ?? ((line) => console.log(line)),
    exit: deps.exit ?? ((code) => exitCli(code)),
    now: deps.now ?? (() => new Date()),
  };
}

/** The issue's existing workspace path, or null after printing why and exiting 1. */
async function existingWorkspace(d: WorkspaceStackCliDeps, issue: string): Promise<string | null> {
  const workspacePath = d.workspacePathFor(issue);
  if (workspacePath && d.pathExists(workspacePath)) return workspacePath;
  d.log(chalk.red(workspacePath ? `No workspace for ${issue} at ${workspacePath}` : `No workspace for ${issue}`));
  await d.exit(1);
  return null;
}

export async function workspaceUpCommand(issueId: string, deps?: Partial<WorkspaceStackCliDeps>): Promise<void> {
  const d = resolveDeps(deps);
  const issue = issueId.toUpperCase();
  const workspacePath = await existingWorkspace(d, issue);
  if (!workspacePath) return;

  const spinner = d.spinner(`Starting the workspace stack for ${issue}...`);
  const result = await d.wake({ issueId: issue, workspacePath, trigger: 'operator' });
  if (result.kind === 'no-stack') {
    spinner.fail(`No Docker stack for ${issue} (${result.reason})`);
    await d.exit(1);
    return;
  }
  if (result.kind === 'failed') {
    spinner.fail(`Could not start the workspace stack for ${issue}: ${result.error}`);
    await d.exit(1);
    return;
  }

  const restored = result.restored.kind === 'restored' ? result.restored.started : [];
  const started = [...new Set([...restored, ...result.started])];
  const alreadyRunning = result.alreadyRunning.filter((name) => !started.includes(name));
  spinner.stop();
  if (started.length === 0) {
    d.log(`Nothing to start for ${issue}`);
  } else {
    d.log(chalk.green(`Started: ${started.join(', ')}`));
  }
  if (alreadyRunning.length > 0) d.log(chalk.dim(`Already running: ${alreadyRunning.join(', ')}`));
}

export async function workspacePinCommand(issueId: string, deps?: Partial<WorkspaceStackCliDeps>): Promise<void> {
  const d = resolveDeps(deps);
  const issue = issueId.toUpperCase();
  const workspacePath = await existingWorkspace(d, issue);
  if (!workspacePath) return;

  d.writePin(workspacePath, d.now());
  d.log(`Pinned ${issue}: its containers are never stopped automatically. Undo with pan workspace unpin ${issue}.`);

  const composeProject = d.composeProjectFor(workspacePath, issue);
  if (!composeProject) return;
  const wakeable = d.wakeableServices(issue);
  const listed = await d.listContainers();
  const stopped = (listed ?? []).some((container) =>
    container.composeProject === composeProject && container.state === 'exited' && wakeable.has(container.composeService));
  if (stopped) d.log(`Run pan workspace up ${issue} to start a stopped stack.`);
}

export async function workspaceUnpinCommand(issueId: string, deps?: Partial<WorkspaceStackCliDeps>): Promise<void> {
  const d = resolveDeps(deps);
  const issue = issueId.toUpperCase();
  const workspacePath = await existingWorkspace(d, issue);
  if (!workspacePath) return;
  d.log(d.removePin(workspacePath) ? `Unpinned ${issue}.` : `${issue} was not pinned.`);
}
