/**
 * `herdr status --json`, parsed (PAN-3956 W5).
 *
 * Also home of the one subprocess seam every `herdr-setup` module shares:
 * `HerdrExec`. It is async (`execFile`, never `execSync`) because `pan up` and
 * the dashboard reach this code, and it RESOLVES on a non-zero exit with the
 * captured output — `herdr` prints diagnostics and JSON either way, so the
 * caller decides what a non-zero exit means. It rejects only when the binary
 * cannot be run at all (ENOENT, EACCES) or the call timed out.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Default subprocess timeout for quick `herdr` calls. */
export const HERDR_EXEC_TIMEOUT_MS = 10_000;

export interface HerdrExecOptions {
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface HerdrExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type HerdrExec = (
  file: string,
  args: readonly string[],
  options?: HerdrExecOptions,
) => Promise<HerdrExecResult>;

interface ExecFileError extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: string | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export const defaultHerdrExec: HerdrExec = async (file, args, options = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(file, [...args], {
      encoding: 'utf-8',
      timeout: options.timeoutMs ?? HERDR_EXEC_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      ...(options.env ? { env: options.env as NodeJS.ProcessEnv } : {}),
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (cause) {
    const error = cause as ExecFileError;
    // A spawn failure carries a string code (ENOENT, EACCES); a timeout kills
    // the child. Both mean "no answer" — reject.
    if (typeof error.code !== 'number' || error.killed) throw error;
    return {
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
      exitCode: error.code,
    };
  }
};

export interface HerdrStatus {
  readonly client: {
    readonly version: string;
    readonly channel: string;
    readonly protocol: number;
    readonly binary: string;
  };
  readonly server: {
    readonly running: boolean;
    readonly version?: string;
    readonly protocol?: number;
    readonly endpointCompatible: boolean;
    readonly socket: string;
    readonly restartNeeded: boolean;
    readonly serverBinaryStale: boolean;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Parse `herdr status --json` output (shape verified on 0.9.1, both with a
 * running server and with none). Null when the text is not that JSON.
 */
export function parseHerdrStatus(text: string): HerdrStatus | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const root = asRecord(raw);
  if (!('client' in root) || !('server' in root)) return null;
  const client = asRecord(root.client);
  const server = asRecord(root.server);
  const update = asRecord(root.update);
  const version = str(server.version);
  const protocol = num(server.protocol);
  return {
    client: {
      version: str(client.version) ?? 'unknown',
      channel: str(client.channel) ?? 'unknown',
      protocol: num(client.protocol) ?? 0,
      binary: str(client.binary) ?? '',
    },
    server: {
      running: server.running === true,
      ...(version !== undefined ? { version } : {}),
      ...(protocol !== undefined ? { protocol } : {}),
      endpointCompatible: server.endpoint_compatible === true,
      socket: str(server.socket) ?? '',
      restartNeeded: server.restart_needed === true || update.restart_needed === true,
      serverBinaryStale: server.server_binary_stale === true || update.server_binary_stale === true,
    },
  };
}

/**
 * `herdr --session <session> status --json`, parsed. Null when the binary
 * cannot run or the output is not the status JSON. A non-zero exit with valid
 * JSON still parses: the JSON is the answer.
 */
export async function readHerdrStatus(
  binary: string,
  session: string,
  exec: HerdrExec = defaultHerdrExec,
): Promise<HerdrStatus | null> {
  try {
    const { stdout } = await exec(binary, ['--session', session, 'status', '--json']);
    return parseHerdrStatus(stdout.trim());
  } catch {
    return null;
  }
}
