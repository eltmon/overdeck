/**
 * Starting a registered worker (PAN-3920 W13, D12–D15).
 *
 * A worker is a native Overdeck agent with role `worker`: `spawnRun` writes its
 * state.json, launches a persistent harness session in a pane on the host's
 * terminal backend (Herdr or tmux) and delivers the brief. It is never a
 * one-shot `claude -p` / `codex exec` run; the caller only observes it.
 *
 * Working directory (D14): a git worktree at `<workspace>/.swarm/worker-<n>/`
 * on branch `<feature-branch>-worker-<n>`, or, with `readOnly`, the issue
 * workspace itself behind a read-only git guard. `cwd` overrides both and must
 * resolve inside the issue workspace. The project's primary checkout is never
 * a worker's directory: a read-write `--cwd` that resolves to one (symlinks
 * followed) is refused (PAN-4338); a `--read-only` worker is not checked.
 */
import { access, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { EffortLevel, EffortSource } from '@overdeck/contracts';

import type { RuntimeName } from '../../runtimes/types.js';
import type { PrimaryCheckoutMatch } from '../../projects/primary-checkout.js';
import { createItemWorktree, worktreeBranch } from '../../workspaces/item-worktree.js';
import type { AgentState } from '../agent-state-read.js';
import { removeAgentStateDir } from '../state-dir-removal.js';
import { resolveEffort, type EffortConfigSlice } from '../resolve-effort.js';
import { writeWorkerFacts as writeFacts, type WorkerFacts } from './facts.js';
import { agentsRoot, allocateWorkerId, workerDir, workerNumber } from './ids.js';

export { readWorkerFacts, type WorkerFacts } from './facts.js';

export interface StartWorkerOptions {
  issueId: string;
  /** The `--prompt` text, or the `--brief` file's content. */
  prompt: string;
  /** Agent id or conversation that spawns the worker; resolved by the CLI. */
  parentId: string | null;
  model?: string;
  harness?: RuntimeName;
  readOnly?: boolean;
  cwd?: string;
  /** Optional label, stored in worker.json. */
  name?: string;
  effort?: string;
}

export interface StartedWorker {
  id: string;
  cwd: string;
  branch: string | null;
  paneReady: true;
}

export type SpawnRunForWorker = (
  issueId: string,
  role: 'worker',
  options: {
    workspace: string;
    agentId: string;
    prompt: string;
    model?: string;
    harness?: RuntimeName;
    parentId?: string;
    gitGuardMode: 'default' | 'read-only';
    startedBy: string;
    registerConversation: false;
    extraEnvExports: string[];
    effort?: EffortLevel;
    effortSource?: EffortSource;
  },
) => Promise<AgentState>;

export interface StartWorkerDeps {
  spawnRun?: SpawnRunForWorker;
  createItemWorktree?: (workspacePath: string, itemId: string) => Promise<string>;
  worktreeBranch?: (path: string) => Promise<string | null>;
  resolveWorkspace?: (issueId: string) => string;
  allocateWorkerId?: (issueId: string) => Promise<string>;
  findPrimaryCheckout?: (path: string) => Promise<PrimaryCheckoutMatch | null>;
  now?: () => Date;
  effortConfig?: EffortConfigSlice;
}

/** An agent id, a conversation tmux session, or `claude-session:<uuid>` (NFR-8). */
export const PARENT_ID_RE = /^[A-Za-z0-9_:.-]+$/;

/** Appended to every brief: how to hand the result back (D15). */
export function reportFooter(id: string): string {
  return [
    '---',
    'When you have finished this brief, write your final report as Markdown to a file and run:',
    `  pan worker report ${id} --file <that file>`,
    'Use --status blocked if you could not finish because you need a decision, --status failed if the brief cannot be done.',
    'Do not run pan done, pan review, or pan task done.',
  ].join('\n');
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function defaultSpawnRun(...args: Parameters<SpawnRunForWorker>): Promise<AgentState> {
  const { spawnRun } = await import('../spawn.js');
  return spawnRun(...args);
}

async function defaultResolveWorkspace(issueId: string): Promise<string> {
  const { defaultRunWorkspace } = await import('../spawn-prep.js');
  return defaultRunWorkspace(issueId);
}

async function defaultFindPrimaryCheckout(path: string): Promise<PrimaryCheckoutMatch | null> {
  const { findPrimaryCheckout } = await import('../../projects/primary-checkout.js');
  return findPrimaryCheckout(path);
}

export async function startWorker(options: StartWorkerOptions, deps: StartWorkerDeps = {}): Promise<StartedWorker> {
  const issueId = options.issueId.toUpperCase();
  if (!options.prompt.trim()) throw new Error('The worker brief is empty.');
  if (options.parentId !== null && !PARENT_ID_RE.test(options.parentId)) {
    throw new Error(`Invalid parent id ${JSON.stringify(options.parentId)}: expected ${PARENT_ID_RE}.`);
  }
  const workspace = deps.resolveWorkspace ? deps.resolveWorkspace(issueId) : await defaultResolveWorkspace(issueId);
  if (!(await exists(workspace))) {
    throw new Error(`${issueId} has no workspace at ${workspace}. Run pan start ${issueId} first.`);
  }
  let explicitCwd: string | null = null;
  if (options.cwd) {
    const requested = resolve(options.cwd);
    if (!(await exists(requested))) throw new Error(`--cwd ${requested} does not exist.`);
    // Both sides canonical: a symlink inside the workspace must not lead out of it.
    const [realWorkspace, realCwd] = await Promise.all([realpath(workspace), realpath(requested)]);
    if (!isInside(realWorkspace, realCwd)) {
      throw new Error(`--cwd ${requested} is outside ${issueId}'s workspace ${workspace}; a worker runs inside its issue workspace.`);
    }
    explicitCwd = realCwd;

    if (options.readOnly !== true) {
      const primary = await (deps.findPrimaryCheckout ?? defaultFindPrimaryCheckout)(realCwd);
      if (primary) {
        const label = primary.repoName ? `${primary.projectKey}/${primary.repoName}` : primary.projectKey;
        throw new Error(`--cwd ${requested} is the primary checkout of ${label}; use a worktree`);
      }
    }
  }

  const workerEffort = resolveEffort({
    explicit: options.effort,
    role: 'worker',
    issueId,
    model: options.model,
    harness: options.harness,
    config: deps.effortConfig,
  });
  if (workerEffort.warning) console.warn(`[worker] ${workerEffort.warning}`);

  const id = await (deps.allocateWorkerId ?? allocateWorkerId)(issueId);
  const readOnly = options.readOnly === true;
  const facts = (cwd: string, branch: string | null): WorkerFacts => ({
    id,
    issueId,
    parentId: options.parentId,
    readOnly,
    cwd,
    branch,
    name: options.name?.trim() || null,
    startedAt: (deps.now ?? (() => new Date()))().toISOString(),
  });

  let cwd = workspace;
  let branch: string | null = null;
  try {
    if (explicitCwd) cwd = explicitCwd;
    else if (!readOnly) {
      cwd = await (deps.createItemWorktree ?? createItemWorktree)(workspace, `worker-${workerNumber(id)}`);
      branch = await (deps.worktreeBranch ?? worktreeBranch)(cwd);
    }

    await (deps.spawnRun ?? defaultSpawnRun)(issueId, 'worker', {
      workspace: cwd,
      agentId: id,
      prompt: `${options.prompt}\n\n${reportFooter(id)}`,
      model: options.model,
      harness: options.harness,
      ...(options.parentId ? { parentId: options.parentId } : {}),
      gitGuardMode: readOnly ? 'read-only' : 'default',
      startedBy: 'pan-worker',
      registerConversation: false,
      extraEnvExports: [`export OVERDECK_WORKER_PARENT=${JSON.stringify(options.parentId ?? '')}`],
      effort: workerEffort.effort,
      effortSource: workerEffort.source,
    });
  } catch (error) {
    if (await exists(join(workerDir(id), 'state.json'))) {
      // The pane may exist (spawnRun records backend/paneId before it fails),
      // so keep the directory and its facts; the caller prints the id to stop it.
      await writeFacts(facts(cwd, branch)).catch(() => {});
    } else {
      // Nothing was launched: drop the claim so `pan worker list` shows no phantom.
      await removeAgentStateDir(workerDir(id), agentsRoot()).catch(() => {});
    }
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { workerId: id });
  }

  await writeFacts(facts(cwd, branch));
  return { id, cwd, branch, paneReady: true };
}
