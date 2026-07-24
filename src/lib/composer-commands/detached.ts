import type { ChildProcess } from 'node:child_process';
import { appendFile, mkdir, open, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { ComposerCommandResult } from '@overdeck/contracts';
import { parseIssueIdSync } from '../issue-id.js';
import { spawnPanCli } from '../pan-cli-invocation.js';
import { getOverdeckHome } from '../paths.js';

export interface DetachedPanCommandInput {
  agentSessionName: string;
  issueId: string;
  role: string;
  workspacePath: string;
  args: string[];
  cwd?: string;
}

export interface DetachedPanCommandLaunch {
  activityId: string;
  completion: Promise<void>;
}

export interface DetachedPanCommandDependencies {
  now?: () => number;
  overdeckHome?: string;
  spawnPanCli?: typeof spawnPanCli;
}

function resolveAgentDirectory(overdeckHome: string, agentId: string): string {
  if (
    agentId.length === 0 ||
    agentId === '.' ||
    agentId === '..' ||
    agentId.includes('/') ||
    agentId.includes('\\') ||
    isAbsolute(agentId)
  ) {
    throw new Error('Agent ID must be a single filesystem-safe path segment.');
  }
  return join(resolve(overdeckHome, 'agents'), agentId);
}

export async function appendAgentLifecycleLog(
  agentId: string,
  event: string,
  details: Record<string, unknown> = {},
  overdeckHome = getOverdeckHome(),
): Promise<void> {
  const agentDir = resolveAgentDirectory(overdeckHome, agentId);
  await mkdir(agentDir, { recursive: true });
  const logLine = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...details,
  });
  await appendFile(join(agentDir, 'lifecycle.log'), `${logLine}\n`);
}

export async function launchPanCommandDetached(
  input: DetachedPanCommandInput,
  dependencies: DetachedPanCommandDependencies = {},
): Promise<DetachedPanCommandLaunch> {
  const { agentSessionName, issueId, role, workspacePath, args } = input;
  const cwd = input.cwd ?? workspacePath;
  const overdeckHome = dependencies.overdeckHome ?? getOverdeckHome();
  const activityId = `activity-${(dependencies.now ?? Date.now)()}`;
  const agentDir = resolveAgentDirectory(overdeckHome, agentSessionName);
  await mkdir(agentDir, { recursive: true });
  const spawnLogPath = join(agentDir, 'spawn.log');
  const spawnLogHandle = await open(spawnLogPath, 'a');
  const spawnCommand = dependencies.spawnPanCli ?? spawnPanCli;
  const child = spawnCommand(args, {
    cwd,
    detached: true,
    stdio: ['ignore', spawnLogHandle.fd, spawnLogHandle.fd],
  });

  let spawned = false;
  let settleSpawn: (() => void) | undefined;
  let rejectSpawn: ((error: Error) => void) | undefined;
  const spawnPromise = new Promise<void>((resolve, reject) => {
    settleSpawn = resolve;
    rejectSpawn = reject;
  });
  const completion = commandCompletion(child, {
    agentSessionName,
    issueId,
    role,
    workspacePath,
    activityId,
    args,
    cwd,
    spawnLogPath,
    spawnLogHandle,
    overdeckHome,
    onSpawn: () => {
      spawned = true;
      settleSpawn?.();
    },
    onError: error => {
      if (!spawned) rejectSpawn?.(error);
    },
  });
  void completion.catch(() => undefined);

  await spawnPromise;
  child.unref();
  return { activityId, completion };
}

interface CompletionContext {
  agentSessionName: string;
  issueId: string;
  role: string;
  workspacePath: string;
  activityId: string;
  args: string[];
  cwd: string;
  spawnLogPath: string;
  spawnLogHandle: Awaited<ReturnType<typeof open>>;
  overdeckHome: string;
  onSpawn(): void;
  onError(error: Error): void;
}

function commandCompletion(child: ChildProcess, context: CompletionContext): Promise<void> {
  child.once('spawn', () => {
    void appendAgentLifecycleLog(context.agentSessionName, 'agent.work_spawn_process_spawned', {
      issueId: context.issueId,
      role: context.role,
      workspacePath: context.workspacePath,
      activityId: context.activityId,
      pid: child.pid,
      args: context.args,
      cwd: context.cwd,
      spawnLogPath: context.spawnLogPath,
    }, context.overdeckHome)
      .catch(() => undefined)
      .finally(context.onSpawn);
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = async (error?: Error) => {
      if (settled) return;
      settled = true;
      await context.spawnLogHandle.close().catch(() => undefined);
      if (error) reject(error);
      else resolve();
    };

    child.once('error', error => {
      void (async () => {
        await appendAgentLifecycleLog(context.agentSessionName, 'agent.work_spawn_process_error', {
          issueId: context.issueId,
          role: context.role,
          workspacePath: context.workspacePath,
          activityId: context.activityId,
          error: error.message,
          args: context.args,
          cwd: context.cwd,
          spawnLogPath: context.spawnLogPath,
        }, context.overdeckHome).catch(() => undefined);
        context.onError(error);
        await finish(error);
      })();
    });

    child.once('close', (code, signal) => {
      void (async () => {
        await appendAgentLifecycleLog(context.agentSessionName, 'agent.work_spawn_process_closed', {
          issueId: context.issueId,
          role: context.role,
          workspacePath: context.workspacePath,
          activityId: context.activityId,
          code,
          signal,
          args: context.args,
          cwd: context.cwd,
          spawnLogPath: context.spawnLogPath,
        }, context.overdeckHome).catch(() => undefined);
        if (code === 0) {
          await finish();
          return;
        }
        const output = await readFile(context.spawnLogPath, 'utf8').catch(() => '');
        const error = new Error(output.trim() || `pan ${context.args.join(' ')} exited with code ${code ?? 'null'}`);
        Object.assign(error, {
          activityId: context.activityId,
          spawnLogPath: context.spawnLogPath,
          code,
          signal,
          output,
        });
        await finish(error);
      })();
    });
  });
}

export async function runDetachedCommand(
  argv: string[],
  dependencies: DetachedPanCommandDependencies = {},
): Promise<ComposerCommandResult> {
  const issueId = argv[1] ?? '';
  const parsedIssueId = parseIssueIdSync(issueId);
  if (!parsedIssueId) {
    return {
      kind: 'terminal-only',
      status: 'rejected',
      message: `/pan ${argv[0] ?? 'command'} requires a canonical issue ID such as PAN-1525.`,
    };
  }
  const role = argv[0] === 'plan' ? 'plan' : 'work';
  const agentSessionName = `${role === 'plan' ? 'planning' : 'agent'}-${parsedIssueId.normalized}`;
  const launch = await launchPanCommandDetached({
    agentSessionName,
    issueId,
    role,
    workspacePath: process.cwd(),
    args: argv,
  }, dependencies);
  void launch.completion.catch(() => undefined);

  const command = `/pan ${argv.join(' ')}`;
  return {
    kind: 'activity',
    status: 'accepted',
    command,
    activityId: launch.activityId,
    message: `Started ${command} for ${issueId}. Watch activity ${launch.activityId} or the ${issueId} issue view for progress.`,
  };
}
