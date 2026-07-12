import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { withBdProcessLock, type BdProcessLockOptions } from '../bd-process-lock.js';
import { exportBeadsJsonl } from './export.js';
import { recordBeadsConflict, recordBeadsPull, recordBeadsPush, recordBeadsSyncError } from './telemetry.js';

const execFileAsync = promisify(execFile);

export interface BeadsMutationProject {
  workspacePath: string;
  projectKey?: string;
}

export interface BeadsMutationContext {
  project: BeadsMutationProject;
  reason: string;
  lockOptions?: BdProcessLockOptions;
}

export interface BdMutationClient {
  run(args: readonly string[]): Promise<string>;
  mutate(args: readonly string[]): Promise<string>;
}

export type MutationBatchResult<T> =
  | { ok: true; value: T; localHead: string | null }
  | { ok: false; conflict: true; localHead: string | null; remoteHead: string | null; message: string }
  | { ok: false; needsOperatorRecovery: true; localHead: string | null; message: string; cause: unknown };

export interface MutationBatchDependencies {
  execute?: (args: readonly string[], cwd: string) => Promise<string>;
  exportSnapshot?: (client: BdMutationClient, cwd: string) => Promise<void>;
  withLock?: typeof withBdProcessLock;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const record = error as Record<string, unknown>;
  return [record.stderr, record.message, record.stdout].filter((value) => typeof value === 'string').join('\n');
}

export function formatMutationBatchFailure(result: Extract<MutationBatchResult<unknown>, { ok: false }>): string {
  if (!('cause' in result)) return result.message;
  const cause = errorText(result.cause).trim();
  return cause ? `${result.message}\nCause: ${cause}` : result.message;
}

function isConflict(error: unknown): boolean {
  return /conflict|non-fast-forward|rejected|diverge/i.test(errorText(error));
}

function parseHead(status: string): string | null {
  return /^Commit:\s*([0-9a-f]{7,40})\s*$/im.exec(status)?.[1] ?? null;
}

async function defaultExecute(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('bd', [...args], { cwd, encoding: 'utf8', timeout: 120_000 });
  return stdout;
}

async function defaultExportSnapshot(client: BdMutationClient, cwd: string): Promise<void> {
  await exportBeadsJsonl(cwd, { execute: (args) => client.run(args) });
}

async function readHead(client: BdMutationClient): Promise<string | null> {
  try {
    return parseHead(await client.run(['vc', 'status']));
  } catch {
    return null;
  }
}

async function readRemoteHead(client: BdMutationClient): Promise<string | null> {
  try {
    const output = await client.run(['dolt', 'remote', 'show', 'origin', '--json']);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const head = parsed.head ?? parsed.commit ?? parsed.remote_head;
    return typeof head === 'string' ? head : null;
  } catch {
    return null;
  }
}

async function hasExistingEmbeddedDoltStore(cwd: string): Promise<boolean> {
  try {
    const storePath = join(cwd, '.beads', 'embeddeddolt');
    const storeStat = await stat(storePath);
    if (!storeStat.isDirectory()) return false;
    return (await readdir(storePath)).length > 0;
  } catch {
    return false;
  }
}

/**
 * The only canonical beads mutation transaction boundary.
 *
 * A batch owns one project lock and one bootstrap/pull/commit/export/push
 * cycle. A failed callback is deliberately left unpushed for operator
 * recovery because bd does not expose a universally safe embedded-mode
 * rollback primitive.
 */
export async function runMutationBatch<T>(
  context: BeadsMutationContext,
  mutate: (client: BdMutationClient) => Promise<T>,
  dependencies: MutationBatchDependencies = {},
): Promise<MutationBatchResult<T>> {
  const execute = dependencies.execute ?? defaultExecute;
  const exportSnapshot = dependencies.exportSnapshot ?? defaultExportSnapshot;
  const withLock = dependencies.withLock ?? withBdProcessLock;
  const cwd = context.project.workspacePath;
  const telemetryKey = context.project.projectKey ?? cwd;
  const client: BdMutationClient = {
    run: (args) => execute(args, cwd),
    mutate: (args) => execute([...args, '--dolt-auto-commit', 'batch'], cwd),
  };

  return withLock(`beads mutation: ${context.reason}`, async () => {
    let value: T;
    try {
      if (!(await hasExistingEmbeddedDoltStore(cwd))) {
        await client.run(['bootstrap', '--yes', '--json']);
      }
      await client.run(['dolt', 'pull']);
      recordBeadsPull(telemetryKey, await readHead(client), await readRemoteHead(client));
      value = await mutate(client);
      await client.run(['dolt', 'commit', '-m', context.reason]);
      await exportSnapshot(client, cwd);
    } catch (error) {
      const localHead = await readHead(client);
      if (isConflict(error)) {
        recordBeadsConflict(telemetryKey, errorText(error));
        return {
          ok: false,
          conflict: true,
          localHead,
          remoteHead: await readRemoteHead(client),
          message: 'The Dolt histories conflict. Nothing was pushed; pull and reconcile the working set before retrying.',
        };
      }
      recordBeadsSyncError(telemetryKey, errorText(error));
      return {
        ok: false,
        needsOperatorRecovery: true,
        localHead,
        message: 'The mutation batch failed before push. The local working set was preserved for operator recovery and no partial plan was published.',
        cause: error,
      };
    }

    try {
      await client.run(['dolt', 'push']);
      const localHead = await readHead(client);
      recordBeadsPush(telemetryKey, localHead);
      return { ok: true, value, localHead };
    } catch (error) {
      recordBeadsConflict(telemetryKey, errorText(error));
      return {
        ok: false,
        conflict: true,
        localHead: await readHead(client),
        remoteHead: await readRemoteHead(client),
        message: 'The Dolt push was rejected. The batch is not durably complete; no force push was attempted.',
      };
    }
  }, { ...context.lockOptions, workspacePath: cwd });
}
