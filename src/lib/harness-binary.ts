import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { loadConfigSync } from './config-yaml.js';
import type { RuntimeName } from './runtimes/types.js';

const execFileAsync = promisify(execFile);
const SAFE_BINARY_NAME = /^[A-Za-z0-9._+-]+$/;

export const HARNESS_BINARY_BY_RUNTIME: Record<RuntimeName, string> = {
  'claude-code': 'claude',
  ohmypi: 'omp',
  codex: 'codex',
  acp: 'kimi',
  'kimi-code': 'kimi',
};

export type ExecutableCommandRunner = (command: string, args: string[]) => Promise<string>;

export interface ExecutableResolutionOptions {
  /** Explicit executable selected by configuration. Must be an absolute path. */
  executablePath?: string;
  pathValue?: string;
  home?: string;
  cwd?: string;
  shell?: string;
  allowLoginShell?: boolean;
  accessExecutable?: (path: string) => Promise<void>;
  runCommand?: ExecutableCommandRunner;
}

const defaultRunCommand: ExecutableCommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  return stdout;
};

async function firstExecutable(
  directories: readonly string[],
  binary: string,
  accessExecutable: (path: string) => Promise<void>,
): Promise<string | null> {
  const seen = new Set<string>();
  for (const directory of directories) {
    if (!directory) continue;
    const candidate = join(directory, binary);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      await accessExecutable(candidate);
      return candidate;
    } catch {
      // Keep searching in the documented order.
    }
  }
  return null;
}

/** Resolve an executable to an absolute, executable path outside the server's inherited PATH alone. */
export async function resolveExecutable(
  binary: string,
  options: ExecutableResolutionOptions = {},
): Promise<string | null> {
  if (!SAFE_BINARY_NAME.test(binary)) {
    throw new Error(`Invalid executable name: ${binary}`);
  }

  const cwd = options.cwd ?? process.cwd();
  const home = resolve(cwd, options.home ?? homedir());
  const pathValue = options.pathValue ?? process.env['PATH'] ?? '';
  const accessExecutable = options.accessExecutable ?? ((path: string) => access(path, constants.X_OK));
  const runCommand = options.runCommand ?? defaultRunCommand;

  if (options.executablePath !== undefined) {
    if (!isAbsolute(options.executablePath)) {
      throw new Error(`Configured executable path must be absolute: ${options.executablePath}`);
    }
    try {
      await accessExecutable(options.executablePath);
      return options.executablePath;
    } catch {
      return null;
    }
  }

  const pathDirectories = pathValue
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => isAbsolute(directory) ? directory : resolve(cwd, directory));
  const pathMatch = await firstExecutable(pathDirectories, binary, accessExecutable);
  if (pathMatch) return pathMatch;

  const fixedCandidates = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
  ];
  const fixedMatch = await firstExecutable(fixedCandidates, binary, accessExecutable);
  if (fixedMatch) return fixedMatch;

  try {
    const npmPrefix = (await runCommand('npm', ['prefix', '-g'])).trim().split('\n')[0]?.trim();
    if (npmPrefix) {
      const npmMatch = await firstExecutable([join(resolve(cwd, npmPrefix), 'bin')], binary, accessExecutable);
      if (npmMatch) return npmMatch;
    }
  } catch {
    // npm is optional; continue to the remaining resolution sources.
  }

  const bunMatch = await firstExecutable([join(home, '.bun', 'bin')], binary, accessExecutable);
  if (bunMatch) return bunMatch;

  if (options.allowLoginShell !== false) {
    const shell = options.shell ?? process.env['SHELL'];
    if (shell) {
      try {
        const shellResult = (await runCommand(shell, ['-lc', `command -v ${binary}`]))
          .trim()
          .split('\n')[0]
          ?.trim();
        if (shellResult && isAbsolute(shellResult)) {
          await accessExecutable(shellResult);
          return shellResult;
        }
      } catch {
        // A login shell is the final optional fallback.
      }
    }
  }

  return null;
}

export function harnessBinaryName(harness: RuntimeName): string {
  return HARNESS_BINARY_BY_RUNTIME[harness];
}

export function configuredHarnessBinaryPath(harness: RuntimeName): string | undefined {
  if (harness === 'acp') return loadConfigSync().config.acp?.kimi?.binaryPath;
  if (harness === 'kimi-code') return loadConfigSync().config.kimiCode?.binaryPath;
  return undefined;
}

function withConfiguredExecutable(
  harness: RuntimeName,
  options: ExecutableResolutionOptions = {},
): ExecutableResolutionOptions {
  if (options.executablePath !== undefined) return options;
  const executablePath = configuredHarnessBinaryPath(harness);
  return executablePath === undefined ? options : { ...options, executablePath };
}

export async function resolveHarnessBinary(
  harness: RuntimeName,
  options?: ExecutableResolutionOptions,
): Promise<string | null> {
  return resolveExecutable(harnessBinaryName(harness), withConfiguredExecutable(harness, options));
}

export async function requireHarnessBinary(
  harness: RuntimeName,
  options?: ExecutableResolutionOptions,
): Promise<string> {
  const binary = harnessBinaryName(harness);
  const effectiveOptions = withConfiguredExecutable(harness, options);
  const resolved = await resolveExecutable(binary, effectiveOptions);
  if (resolved) return resolved;

  const harnessName = harness === 'claude-code'
    ? 'Claude Code'
    : harness === 'ohmypi'
      ? 'OhMyPi'
      : harness === 'codex'
        ? 'Codex CLI'
        : harness === 'kimi-code'
          ? 'Kimi Code CLI'
          : 'Kimi Code CLI'; // acp drives the native Kimi Code CLI binary too
  if (effectiveOptions.executablePath) {
    throw new Error(
      `${harnessName} configured executable "${effectiveOptions.executablePath}" was not found or is not executable. Fix its configured path, then restart Overdeck. No terminal session was created.`,
    );
  }
  throw new Error(
    `${harnessName} executable "${binary}" was not found. Install ${harnessName} or add its installation directory to PATH, then restart Overdeck. No terminal session was created.`,
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function harnessPathExport(resolvedBinary: string): string {
  return `export PATH=${shellQuote(dirname(resolvedBinary))}:"$PATH"`;
}

export async function prepareHarnessLaunch(
  harness: RuntimeName,
  options?: ExecutableResolutionOptions,
): Promise<{ binaryPath: string; pathExport: string }> {
  const binaryPath = await requireHarnessBinary(harness, options);
  return { binaryPath, pathExport: harnessPathExport(binaryPath) };
}
