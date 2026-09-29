/** Shared fixtures for the pan vault CLI tests: captured io, temp homes, a bare git remote. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliIo } from '../../../../src/cli/commands/vault/shared.js';

export class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

export interface CapturedIo extends CliIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
  answers: string[];
}

export function captureIo(options: { isTTY?: boolean; answers?: string[] } = {}): CapturedIo {
  const io: CapturedIo = {
    stdout: [],
    stderr: [],
    exitCode: null,
    answers: [...(options.answers ?? [])],
    isTTY: options.isTTY ?? false,
    out: (line) => { io.stdout.push(line); },
    err: (line) => { io.stderr.push(line); },
    exit: async (code) => {
      io.exitCode = code;
      throw new ExitSignal(code);
    },
    readLine: async () => io.answers.shift() ?? '',
  };
  return io;
}

/** Run a command function; a CLI exit becomes the returned code instead of a throw. */
export async function runCli(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 0;
  } catch (error) {
    if (error instanceof ExitSignal) return error.code;
    throw error;
  }
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
}

export class Fixture {
  readonly root = mkdtempSync(join(tmpdir(), 'pan-vault-cli-'));
  private originalHome = process.env.OVERDECK_HOME;
  private originalUserHome = process.env.HOME;

  bareRepo(name = 'remote.git'): string {
    const dir = join(this.root, name);
    git(this.root, 'init', '--quiet', '--bare', dir);
    return dir;
  }

  /** Point OVERDECK_HOME (and HOME, for ~/.claude) at a machine-specific pair of dirs. */
  useMachine(name: string): { home: string; overdeckHome: string } {
    const home = join(this.root, name);
    const overdeckHome = join(home, '.overdeck');
    process.env.HOME = home;
    process.env.OVERDECK_HOME = overdeckHome;
    return { home, overdeckHome };
  }

  cleanup(): void {
    if (this.originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = this.originalHome;
    if (this.originalUserHome === undefined) delete process.env.HOME;
    else process.env.HOME = this.originalUserHome;
    rmSync(this.root, { recursive: true, force: true });
  }
}
