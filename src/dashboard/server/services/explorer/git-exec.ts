/**
 * Explorer git runner (PAN-5183).
 *
 * The one async `spawn('git', …)` wrapper every explorer service uses
 * (NFR-A1). Every call:
 *   - passes `-c core.fsmonitor=false --literal-pathspecs`, so `*`, `?`, `[`
 *     and a leading `:` in a path argument are plain characters. The one
 *     exception is `check-ignore`: git rejects the flag there ("pathspec
 *     magic not supported by this command: 'literal'") and already reads its
 *     paths as literal names, so the runner omits it for that subcommand;
 *   - sets `GIT_OPTIONAL_LOCKS=0`, so `git status` never rewrites
 *     `.git/index` and never contends for `index.lock` with an agent;
 *   - sets `GIT_TERMINAL_PROMPT=0`, so git never waits on a credential prompt;
 *   - is killed after `timeoutMs` and when stdout passes `maxBytes`.
 *
 * A non-zero exit resolves normally (callers read `code`); the promise
 * rejects only when git cannot be spawned at all.
 */
import { spawn } from 'node:child_process';
import { explorerError } from './errors.js';

export interface GitRunResult {
  /** Exit code; null when the process was killed. */
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface GitRunOptions {
  /** Written to stdin, which is then closed. */
  input?: string;
  /** Default 10_000. */
  timeoutMs?: number;
  /** Stdout cap in bytes. Default 64 MiB. */
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

/** Subcommands that reject `--literal-pathspecs` and take only literal paths. */
const NO_LITERAL_PATHSPECS = new Set(['check-ignore']);

function gitArgv(args: readonly string[]): string[] {
  const literal = NO_LITERAL_PATHSPECS.has(args[0] ?? '') ? [] : ['--literal-pathspecs'];
  return ['-c', 'core.fsmonitor=false', ...literal, ...args];
}

export async function runGit(cwd: string, args: readonly string[], opts: GitRunOptions = {}): Promise<GitRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  return new Promise<GitRunResult>((resolve, reject) => {
    const child = spawn('git', gitArgv(args), {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      const room = maxBytes - stdoutBytes;
      if (chunk.length > room) {
        if (room > 0) stdoutChunks.push(chunk.subarray(0, room));
        stdoutBytes = maxBytes;
        truncated = true;
        child.kill('SIGKILL');
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const room = MAX_STDERR_BYTES - stderrBytes;
      if (room <= 0) return;
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      stderrChunks.push(kept);
      stderrBytes += kept.length;
    });

    // git may exit before reading all of stdin (or be killed); an EPIPE on
    // stdin is not a failure of the run.
    child.stdin.on('error', () => {});

    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(explorerError('EXPLORER_FAILED', `git is not available: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        truncated,
      });
    });

    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}
