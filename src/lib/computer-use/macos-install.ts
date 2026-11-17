/**
 * Installs the macOS computer-use helper app (PAN-5463, PRD WI-3, D-1, D-11).
 *
 * The npm package ships `native/computer-use-macos/dist/overdeck-computer-use-macos.zip`
 * and its `.sha256`. Setup extracts the zip to
 * `~/.overdeck/computer-use/macos/Overdeck Computer Use.app` and records the
 * zip's sha256 in `installed.sha256`. macOS attaches the Accessibility and
 * Screen Recording grants to that installed copy, so it never moves; a newer
 * zip replaces it in place (status `updated`, which may need the grants again).
 *
 * A source checkout has no zip until it builds one: with an Xcode toolchain,
 * `installHelper` runs `npm run build:computer-macos` first.
 *
 * Child processes run through async execFile only (NFR-1); every fs and exec
 * call is injectable for tests.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { packageRoot } from '../paths.js';
import { ComputerUseError } from './errors.js';
import { computerUseDir } from './paths.js';

const execFileAsync = promisify(execFile);

export const HELPER_APP_NAME = 'Overdeck Computer Use.app';
const ZIP_NAME = 'overdeck-computer-use-macos.zip';
const DITTO = '/usr/bin/ditto';
const XCODE_SELECT = '/usr/bin/xcode-select';
const DEV_BUILD_TIMEOUT_MS = 15 * 60_000;
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;
export const XCODE_CLT_FIX = 'Install Xcode Command Line Tools: xcode-select --install';

export type MacosExecFileFn = (
  file: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface MacosInstallDeps {
  execFile?: MacosExecFileFn;
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  writeFile?: (path: string, data: string, options: { mode: number }) => Promise<void>;
  mkdir?: (path: string, options: { recursive: true; mode: number }) => Promise<unknown>;
  rename?: (from: string, to: string) => Promise<void>;
  rm?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  pathExists?: (path: string) => Promise<boolean>;
  randomUUID?: () => string;
  packageRoot?: string;
  /** True when an Xcode toolchain (and so `swift`) is installed. */
  hasSwiftToolchain?: () => Promise<boolean>;
}

export interface InstallResult {
  /** installed = first install; current = nothing to do; updated = replaced an older helper. */
  status: 'installed' | 'current' | 'updated';
}

export function installedHelperDir(): string {
  return join(computerUseDir(), 'macos');
}

export function installedHelperPath(): string {
  return join(installedHelperDir(), HELPER_APP_NAME);
}

function installedShaPath(): string {
  return join(installedHelperDir(), 'installed.sha256');
}

export function bundledZipPath(root: string = packageRoot): string {
  return join(root, 'native', 'computer-use-macos', 'dist', ZIP_NAME);
}

async function defaultPathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function resolveDeps(deps: MacosInstallDeps) {
  const exec: MacosExecFileFn = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options ?? {}));
  return {
    exec,
    readFile: deps.readFile ?? ((path: string, encoding: 'utf8') => readFile(path, encoding)),
    writeFile: deps.writeFile ?? ((path: string, data: string, options: { mode: number }) => writeFile(path, data, options)),
    mkdir: deps.mkdir ?? ((path: string, options: { recursive: true; mode: number }) => mkdir(path, options)),
    rename: deps.rename ?? rename,
    rm: deps.rm ?? ((path: string, options: { recursive: true; force: true }) => rm(path, options)),
    pathExists: deps.pathExists ?? defaultPathExists,
    randomUUID: deps.randomUUID ?? randomUUID,
    packageRoot: deps.packageRoot ?? packageRoot,
    hasSwiftToolchain:
      deps.hasSwiftToolchain ??
      (async () => {
        // `/usr/bin/swift` exists on every Mac as a stub that offers to install
        // the tools, so ask xcode-select whether a toolchain is really there.
        try {
          await exec(XCODE_SELECT, ['-p'], { timeout: 10_000 });
          return true;
        } catch {
          return false;
        }
      }),
  };
}

async function readSha(read: (path: string, encoding: 'utf8') => Promise<string>, path: string): Promise<string | null> {
  try {
    const text = (await read(path, 'utf8')).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** True when the installed helper exists and came from the zip this package ships. */
export async function isInstalledCurrent(deps: MacosInstallDeps = {}): Promise<boolean> {
  const d = resolveDeps(deps);
  const bundledSha = await readSha(d.readFile, `${bundledZipPath(d.packageRoot)}.sha256`);
  if (bundledSha === null) return false;
  const installedSha = await readSha(d.readFile, installedShaPath());
  return installedSha === bundledSha && (await d.pathExists(installedHelperPath()));
}

/** Builds the zip in a source checkout (D-11), or explains how to get the tools. */
async function buildFromSource(d: ReturnType<typeof resolveDeps>, zipPath: string): Promise<void> {
  if (!(await d.hasSwiftToolchain())) {
    throw new ComputerUseError('helper_missing_dependency', XCODE_CLT_FIX);
  }
  try {
    await d.exec('npm', ['run', 'build:computer-macos'], {
      cwd: d.packageRoot,
      timeout: DEV_BUILD_TIMEOUT_MS,
      maxBuffer: EXEC_MAX_BUFFER,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    throw new ComputerUseError(
      'helper_error',
      `npm run build:computer-macos failed: ${stderr.slice(-500) || (error as Error).message}`,
    );
  }
  if (!(await d.pathExists(zipPath))) {
    throw new ComputerUseError('helper_error', `npm run build:computer-macos did not produce ${zipPath}`);
  }
}

/** Extracts the bundled helper into place unless the installed copy is already current. */
export async function installHelper(deps: MacosInstallDeps = {}): Promise<InstallResult> {
  const d = resolveDeps(deps);
  const zipPath = bundledZipPath(d.packageRoot);
  if (!(await d.pathExists(zipPath))) {
    await buildFromSource(d, zipPath);
  }

  const bundledSha = await readSha(d.readFile, `${zipPath}.sha256`);
  if (bundledSha === null) {
    throw new ComputerUseError('helper_error', `${zipPath}.sha256 is missing or empty`);
  }
  const installedSha = await readSha(d.readFile, installedShaPath());
  const appPath = installedHelperPath();
  if (installedSha === bundledSha && (await d.pathExists(appPath))) {
    return { status: 'current' };
  }

  const dir = installedHelperDir();
  await d.mkdir(dir, { recursive: true, mode: 0o700 });
  const extractDir = join(dir, `.extract-${d.randomUUID()}`);
  try {
    try {
      await d.exec(DITTO, ['-x', '-k', zipPath, extractDir], { timeout: 120_000, maxBuffer: EXEC_MAX_BUFFER });
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      throw new ComputerUseError('helper_error', `ditto could not extract ${zipPath}: ${stderr.trim() || (error as Error).message}`);
    }
    await d.rm(appPath, { recursive: true, force: true });
    await d.rename(join(extractDir, HELPER_APP_NAME), appPath);
    await d.writeFile(installedShaPath(), `${bundledSha}\n`, { mode: 0o600 });
  } finally {
    await d.rm(extractDir, { recursive: true, force: true });
  }
  return { status: installedSha !== null && installedSha !== bundledSha ? 'updated' : 'installed' };
}
