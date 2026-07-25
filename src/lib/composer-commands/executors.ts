import type { ChildProcess } from 'node:child_process';

import type { ComposerCommandResult } from '@overdeck/contracts';
import { spawnPanCli } from '../pan-cli-invocation.js';

export const CAPTURED_COMMAND_MAX_OUTPUT_BYTES = 64 * 1024;
export const CAPTURED_COMMAND_TIMEOUT_MS = 30_000;

const TRUNCATION_MESSAGE = '\n\nOutput was truncated after 65,536 bytes.';

export interface CapturedCommandDependencies {
  spawnPanCli?: typeof spawnPanCli;
  timeoutMs?: number;
}

export function runCapturedCommand(
  argv: readonly string[],
  dependencies: CapturedCommandDependencies = {},
): Promise<ComposerCommandResult> {
  const command = `/pan ${argv.join(' ')}`;
  const spawnCommand = dependencies.spawnPanCli ?? spawnPanCli;
  const timeoutMs = dependencies.timeoutMs ?? CAPTURED_COMMAND_TIMEOUT_MS;
  const child = spawnCommand(argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let bufferedBytes = 0;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let truncated = false;

    const appendOutput = (data: string | Buffer) => {
      if (truncated) return;
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const maximumPrefixBytes = CAPTURED_COMMAND_MAX_OUTPUT_BYTES - Buffer.byteLength(TRUNCATION_MESSAGE);
      const remaining = maximumPrefixBytes - bufferedBytes;
      if (buffer.length <= remaining) {
        chunks.push(buffer);
        bufferedBytes += buffer.length;
        return;
      }
      if (remaining > 0) {
        chunks.push(buffer.subarray(0, remaining));
        bufferedBytes += remaining;
      }
      truncated = true;
    };

    const output = () => {
      const captured = Buffer.concat(chunks, bufferedBytes).toString('utf8');
      return truncated ? `${captured}${TRUNCATION_MESSAGE}` : captured;
    };

    const finish = (result: ComposerCommandResult) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      resolve(result);
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    child.once('error', error => {
      finish({
        kind: 'captured',
        status: 'failed',
        command,
        output: `Command ${command} could not start: ${error.message}`,
        truncated: false,
      });
    });

    child.once('close', code => {
      const captured = output();
      finish({
        kind: 'captured',
        status: code === 0 ? 'completed' : 'failed',
        command,
        output: captured || `Command ${command} ${code === 0 ? 'completed without output.' : `failed with exit code ${code ?? 'unknown'}.`}`,
        truncated,
      });
    });

    timeout = setTimeout(() => {
      stopChild(child);
      finish({
        kind: 'captured',
        status: 'failed',
        command,
        output: `Command ${command} timed out after ${Math.round(timeoutMs / 1000)} seconds and was stopped.`,
        truncated: false,
      });
    }, timeoutMs);
  });
}

function stopChild(child: ChildProcess): void {
  child.kill('SIGTERM');
}
