import type { ChildProcess } from 'node:child_process';
import { appendFile, mkdir, open } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { ComposerCommandResult } from '@overdeck/contracts';
import { emitActivityEntryDurable, type EmitActivityOptions } from '../activity-logger.js';
import { parseIssueIdSync } from '../issue-id.js';
import { spawnPanCli } from '../pan-cli-invocation.js';
import { getOverdeckHome } from '../paths.js';
import { CAPTURED_COMMAND_MAX_OUTPUT_BYTES } from './executors.js';

export interface DetachedPanCommandInput {
  agentSessionName: string;
  issueId: string;
  role: string;
  workspacePath: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  activityId?: string;
}

export interface DetachedPanCommandLaunch {
  activityId: string;
  spawnLogPath: string;
  spawnLogStart: number;
  completion: Promise<void>;
}

export interface DetachedPanCommandDependencies {
  now?: () => number;
  overdeckHome?: string;
  spawnPanCli?: typeof spawnPanCli;
  emitActivity?: (options: EmitActivityOptions) => Promise<void>;
}

const DETACHED_TRUNCATION_MESSAGE = '\n\nOutput was truncated after 65,536 bytes.';

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

async function readBoundedSpawnOutput(spawnLogPath: string, startOffset: number): Promise<string> {
  const maximumPrefixBytes = CAPTURED_COMMAND_MAX_OUTPUT_BYTES - Buffer.byteLength(DETACHED_TRUNCATION_MESSAGE);
  const handle = await open(spawnLogPath, 'r');
  try {
    const stats = await handle.stat();
    const outputBytes = Math.max(0, stats.size - startOffset);
    if (outputBytes === 0) return '';
    const bytesToRead = Math.min(outputBytes, maximumPrefixBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, startOffset);
    const output = buffer.subarray(0, bytesRead).toString('utf8');
    return outputBytes > maximumPrefixBytes
      ? `${output}${DETACHED_TRUNCATION_MESSAGE}`
      : output;
  } finally {
    await handle.close().catch(() => undefined);
  }
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
  const activityId = input.activityId ?? `activity-${(dependencies.now ?? Date.now)()}`;
  const agentDir = resolveAgentDirectory(overdeckHome, agentSessionName);
  await mkdir(agentDir, { recursive: true });
  const spawnLogPath = join(agentDir, 'spawn.log');
  const spawnLogHandle = await open(spawnLogPath, 'a');
  const spawnLogStart = (await spawnLogHandle.stat()).size;
  const spawnCommand = dependencies.spawnPanCli ?? spawnPanCli;
  const child = spawnCommand(args, {
    cwd,
    detached: true,
    stdio: ['ignore', spawnLogHandle.fd, spawnLogHandle.fd],
    env: { ...process.env, ...input.env },
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
    spawnLogStart,
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
  return { activityId, spawnLogPath, spawnLogStart, completion };
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
  spawnLogStart: number;
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
        const output = await readBoundedSpawnOutput(context.spawnLogPath, context.spawnLogStart).catch(() => '');
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
  const command = `/pan ${argv.join(' ')}`;
  const activityId = `activity-${(dependencies.now ?? Date.now)()}`;
  const emitActivity = dependencies.emitActivity ?? emitActivityEntryDurable;
  const source = role === 'plan' ? 'planning-agent' : 'work-agent';
  const emitTransition = (
    status: 'accepted' | 'running' | 'completed' | 'failed',
    level: 'info' | 'success' | 'error',
    message: string,
    output?: string,
  ) => emitActivity({
    id: activityId,
    source,
    level,
    status,
    command,
    message,
    details: output,
    output,
    issueId,
  });

  await emitTransition(
    'accepted',
    'info',
    `Accepted ${command} for ${issueId} as activity ${activityId}.`,
  );

  let launch: DetachedPanCommandLaunch;
  try {
    launch = await launchPanCommandDetached({
      agentSessionName,
      issueId,
      role,
      workspacePath: process.cwd(),
      args: argv,
      activityId,
    }, dependencies);
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    await emitTransition(
      'failed',
      'error',
      `Activity ${activityId} failed to start ${command} for ${issueId}.`,
      output,
    ).catch(() => undefined);
    throw error;
  }

  await emitTransition(
    'running',
    'info',
    `Activity ${activityId} is running ${command} for ${issueId}.`,
  ).catch(() => undefined);

  void launch.completion.then(async () => {
    const output = await readBoundedSpawnOutput(launch.spawnLogPath, launch.spawnLogStart).catch(() => '');
    await emitTransition(
      'completed',
      'success',
      `Activity ${activityId} completed ${command} for ${issueId}.`,
      output || `Command ${command} completed without output.`,
    );
  }, async error => {
    const activityError = error as Error & { output?: string };
    const output = activityError.output?.trim() || activityError.message;
    await emitTransition(
      'failed',
      'error',
      `Activity ${activityId} failed ${command} for ${issueId}.`,
      output,
    );
  }).catch(() => undefined);

  return {
    kind: 'activity',
    status: 'accepted',
    command,
    activityId: launch.activityId,
    message: `Started ${command} for ${issueId}. Watch activity ${launch.activityId} or the ${issueId} issue view for progress.`,
  };
}
