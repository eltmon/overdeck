/**
 * Runs the vendored Orca helper against one JSON operation file (PAN-5452, PRD 3c).
 * The op file is written mode 0600 under an 0700 dir and always removed. `env`
 * is a parameter rather than read here: the preamble (run.ts) resolves the
 * desktop session env once and passes it in.
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ComputerUseError } from './errors.js';
import { helperPath, opsDir, SYSTEM_PYTHON } from './paths.js';

const execFileAsync = promisify(execFile);

const HELPER_TIMEOUT_MS = 30_000;
const HELPER_MAX_BUFFER = 64 * 1024 * 1024;
const APT_FIX = 'sudo apt install python3-gi gir1.2-atspi-2.0';

export type HelperResponse = Record<string, unknown> & { ok: boolean };

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export type ExecFileFn = (
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; killSignal: NodeJS.Signals; maxBuffer: number },
) => Promise<ExecFileResult>;

export interface RunHelperDeps {
  execFile?: ExecFileFn;
  mkdir?: typeof mkdir;
  writeFile?: typeof writeFile;
  rm?: typeof rm;
  helperPath?: () => string;
  opsDir?: () => string;
  systemPython?: string;
  randomUUID?: () => string;
}

/** Only `killed` decides a timeout — a trapped SIGTERM would leave `signal`/`code` ambiguous. */
function isTimeoutError(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { killed?: boolean }).killed === true;
}

function isEnoent(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function mentionsMissingAtspi(message: string): boolean {
  return /\bgi\b/.test(message) || /atspi/i.test(message);
}

function lastNonEmptyLine(text: string): string | undefined {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.at(-1);
}

/** The last non-empty stdout line as JSON; shared by the Linux and Windows bridges (PAN-5462 D-6). */
export function parseHelperOutput(stdout: string, stderr: string): HelperResponse {
  const lastLine = lastNonEmptyLine(stdout);
  if (lastLine === undefined) {
    throw new ComputerUseError('helper_error', `pan computer: the helper printed no output.${stderr ? ` stderr: ${stderr.slice(-500)}` : ''}`);
  }
  try {
    return JSON.parse(lastLine) as HelperResponse;
  } catch {
    throw new ComputerUseError('helper_error', `pan computer: the helper's output was not JSON: ${lastLine.slice(0, 500)}`);
  }
}

export async function runHelper(
  operation: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  deps: RunHelperDeps = {},
): Promise<HelperResponse> {
  const exec = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
  const mkdirFn = deps.mkdir ?? mkdir;
  const writeFileFn = deps.writeFile ?? writeFile;
  const rmFn = deps.rm ?? rm;
  const resolveHelperPath = deps.helperPath ?? helperPath;
  const resolveOpsDir = deps.opsDir ?? opsDir;
  const systemPython = deps.systemPython ?? SYSTEM_PYTHON;
  const uuid = deps.randomUUID ?? randomUUID;

  const dir = resolveOpsDir();
  await mkdirFn(dir, { recursive: true, mode: 0o700 });
  const opFile = join(dir, `${uuid()}.json`);

  let stdout: string;
  let stderr: string;
  try {
    // Inside the try/finally: a write that creates the file and then fails
    // partway (e.g. ENOSPC) must still be cleaned up below.
    await writeFileFn(opFile, JSON.stringify(operation), { mode: 0o600 });
    try {
      const result = await exec(systemPython, ['-I', resolveHelperPath(), opFile], {
        env,
        timeout: HELPER_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: HELPER_MAX_BUFFER,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new ComputerUseError('helper_timeout', `pan computer: the helper did not respond within ${HELPER_TIMEOUT_MS}ms and was killed`);
      }
      if (isEnoent(error)) {
        throw new ComputerUseError('helper_missing_dependency', `${systemPython} was not found. ${APT_FIX}`);
      }
      const failedStderr = (error as { stderr?: string }).stderr ?? '';
      if (mentionsMissingAtspi(failedStderr)) {
        throw new ComputerUseError('helper_missing_dependency', APT_FIX);
      }
      throw new ComputerUseError('helper_error', failedStderr.slice(-500) || (error as Error).message);
    }
  } finally {
    await rmFn(opFile, { force: true });
  }

  const parsed = parseHelperOutput(stdout, stderr);
  if (parsed.ok === false) {
    const message = typeof parsed.error === 'string' ? parsed.error : 'unknown helper error';
    if (mentionsMissingAtspi(message)) {
      throw new ComputerUseError('helper_missing_dependency', APT_FIX);
    }
    throw new ComputerUseError('helper_error', message);
  }
  return parsed;
}
