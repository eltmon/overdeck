/**
 * PAN-5489: run `pan workspace create` for an issue spawn.
 *
 * Resolves to the failure message, or null on success, and never rejects: a
 * rejected `Effect.promise` is a defect that a try/catch around `yield*` does
 * not see, so the caller would otherwise answer an unlogged 500 with no message.
 */
import type { ExecOptions } from 'node:child_process';
import { dirname } from 'node:path';
import { buildChildEnvWithoutTmux } from '../../../../lib/child-env.js';

/** The shape of the promisified `exec` the spawn route passes in. */
export type SpawnExec = (command: string, options: ExecOptions & { encoding: BufferEncoding }) => Promise<unknown>;

/** The failure message, or null on success. Never rejects. */
export async function runSpawnWorkspaceCreate(
  issueId: string,
  projectPath: string,
  exec: SpawnExec,
): Promise<string | null> {
  const nodeDir = dirname(process.execPath);
  try {
    await exec(`pan workspace create ${issueId} --local`, {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 60000,
      env: buildChildEnvWithoutTmux(process.env, { PATH: `${nodeDir}:${process.env.PATH ?? ''}` }),
    });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[spawn-issue] pan workspace create failed for ${issueId}: ${message}`);
    return message;
  }
}
