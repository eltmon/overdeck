/**
 * The file-manager integration: right-click "Open in Overdeck" (PAN-5349
 * O-D12, O-D13). CLI-only: `pan integrate file-manager` and `pan install`
 * call it, and `pan doctor` reads its state file.
 *
 * Planning is pure: `planFileManagerInstall` and `planFileManagerRemove`
 * return the files to write, the paths to delete and the commands to run.
 * `applyFileManagerPlan` carries a plan out with `fs/promises` and an async
 * `execFile` (argv arrays, never a shell string built from a path).
 *
 * What was installed is recorded in `<OVERDECK_HOME>/integrations/file-manager.json`,
 * its own file rather than `config.yaml`, which dashboard settings doors rewrite.
 */
import { execFile } from 'node:child_process';
import { access, chmod, copyFile, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';
import { promisify } from 'node:util';

import { getOverdeckHome } from '../paths.js';
import { findExecutableOnPath, panCliBundlePath, panCliShimDir } from '../pan-cli-shim.js';
import { renderDolphinServiceMenu, renderNautilusScript, renderOpenWithDesktopEntry } from './templates/linux.js';
import { renderQuickActionInfoPlist, renderQuickActionWorkflow } from './templates/macos.js';

export type FileManagerPlatform = 'linux' | 'darwin' | 'win32';

export interface PlannedFile {
  path: string;
  content: string;
  mode: number;
}

export interface PlannedCommand {
  cmd: string;
  args: string[];
  /** A missing binary or a failed run is a note, not an error. */
  optional: boolean;
}

export interface FileManagerPlan {
  files: PlannedFile[];
  deletes: string[];
  /** Directories removed after the deletes, only when empty (the macOS bundle folders). */
  pruneDirs: string[];
  commands: PlannedCommand[];
  registryKeys: string[];
}

export interface FileManagerState {
  installed: true;
  platform: FileManagerPlatform;
  panPath: string;
  at: string;
  files: string[];
  registryKeys: string[];
}

export const MENU_LABEL = 'Open in Overdeck';

const WINDOWS_KEY_ROOT = 'HKCU\\Software\\Classes';
/** Registry keys under HKCU\Software\Classes, with the argument the command passes. */
const WINDOWS_KEYS: readonly { key: string; arg: string }[] = [
  { key: `${WINDOWS_KEY_ROOT}\\*\\shell\\OpenInOverdeck`, arg: '%1' },
  { key: `${WINDOWS_KEY_ROOT}\\Directory\\shell\\OpenInOverdeck`, arg: '%1' },
  { key: `${WINDOWS_KEY_ROOT}\\Directory\\Background\\shell\\OpenInOverdeck`, arg: '%V' },
];

const MAC_PBS = '/System/Library/CoreServices/pbs';

export function isFileManagerPlatform(platform: string): platform is FileManagerPlatform {
  return platform === 'linux' || platform === 'darwin' || platform === 'win32';
}

function linuxPaths(home: string) {
  const applications = join(home, '.local', 'share', 'applications');
  return {
    applications,
    openWith: join(applications, 'overdeck-open.desktop'),
    nautilus: join(home, '.local', 'share', 'nautilus', 'scripts', MENU_LABEL),
    dolphin: join(home, '.local', 'share', 'kio', 'servicemenus', 'overdeck-open.desktop'),
  };
}

function macBundle(home: string): string {
  return join(home, 'Library', 'Services', `${MENU_LABEL}.workflow`);
}

/** The files, commands and registry keys that install the integration. */
export function planFileManagerInstall(input: {
  platform: FileManagerPlatform;
  home: string;
  panPath: string;
  iconPath?: string | null;
}): FileManagerPlan {
  const { platform, home, panPath, iconPath } = input;
  const plan: FileManagerPlan = { files: [], deletes: [], pruneDirs: [], commands: [], registryKeys: [] };
  if (platform === 'linux') {
    const paths = linuxPaths(home);
    plan.files.push(
      { path: paths.openWith, content: renderOpenWithDesktopEntry(panPath, iconPath), mode: 0o644 },
      { path: paths.nautilus, content: renderNautilusScript(panPath), mode: 0o755 },
      { path: paths.dolphin, content: renderDolphinServiceMenu(panPath, iconPath), mode: 0o755 },
    );
    plan.commands.push({ cmd: 'update-desktop-database', args: [paths.applications], optional: true });
  } else if (platform === 'darwin') {
    const contents = join(macBundle(home), 'Contents');
    plan.files.push(
      { path: join(contents, 'Info.plist'), content: renderQuickActionInfoPlist(), mode: 0o644 },
      { path: join(contents, 'document.wflow'), content: renderQuickActionWorkflow(panPath), mode: 0o644 },
    );
    plan.commands.push({ cmd: MAC_PBS, args: ['-update'], optional: true });
  } else {
    for (const { key, arg } of WINDOWS_KEYS) {
      plan.commands.push(
        { cmd: 'reg', args: ['add', key, '/ve', '/d', MENU_LABEL, '/f'], optional: false },
        { cmd: 'reg', args: ['add', `${key}\\command`, '/ve', '/d', `"${panPath}" open "${arg}"`, '/f'], optional: false },
      );
      plan.registryKeys.push(key);
    }
  }
  return plan;
}

/** The deletes and commands that remove exactly what `state` recorded. */
export function planFileManagerRemove(state: FileManagerState): FileManagerPlan {
  const plan: FileManagerPlan = { files: [], deletes: [...state.files], pruneDirs: [], commands: [], registryKeys: [...state.registryKeys] };
  for (const key of state.registryKeys) plan.commands.push({ cmd: 'reg', args: ['delete', key, '/f'], optional: true });
  if (state.platform === 'linux') {
    const applications = dirname(state.files.find((file) => file.endsWith('overdeck-open.desktop') && file.includes('applications')) ?? '');
    if (applications !== '.') plan.commands.push({ cmd: 'update-desktop-database', args: [applications], optional: true });
  } else if (state.platform === 'darwin') {
    const bundles = new Set<string>();
    for (const file of state.files) {
      const match = /^(.*\.workflow)\/Contents\//.exec(file);
      if (match?.[1]) bundles.add(match[1]);
    }
    for (const bundle of bundles) plan.pruneDirs.push(join(bundle, 'Contents'), bundle);
    plan.commands.push({ cmd: MAC_PBS, args: ['-update'], optional: true });
  }
  return plan;
}

/** One line per file, delete and command, for `--dry-run`. */
export function describeFileManagerPlan(plan: FileManagerPlan): string[] {
  return [
    ...plan.deletes.map((path) => `delete ${path}`),
    ...plan.files.map((file) => `write  ${file.path} (mode ${file.mode.toString(8)})`),
    ...plan.commands.map((command) => `run    ${[command.cmd, ...command.args].join(' ')}${command.optional ? ' (if present)' : ''}`),
  ];
}

export interface ApplyDeps {
  mkdir: (path: string) => Promise<unknown>;
  writeFile: (path: string, content: string) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  rm: (path: string) => Promise<void>;
  rmdir: (path: string) => Promise<void>;
  execFile: (cmd: string, args: string[]) => Promise<unknown>;
  note: (line: string) => void;
}

const execFileAsync = promisify(execFile);

const defaultApplyDeps: ApplyDeps = {
  mkdir: (path) => mkdir(path, { recursive: true }),
  writeFile: (path, content) => writeFile(path, content, 'utf8'),
  chmod: (path, mode) => chmod(path, mode),
  rm: (path) => rm(path, { force: true }),
  rmdir: (path) => rmdir(path),
  execFile: (cmd, args) => execFileAsync(cmd, args),
  note: () => undefined,
};

/** Carry out `plan`: deletes, then files, then commands. A failed required command throws. */
export async function applyFileManagerPlan(plan: FileManagerPlan, overrides: Partial<ApplyDeps> = {}): Promise<void> {
  const deps = { ...defaultApplyDeps, ...overrides };
  for (const path of plan.deletes) await deps.rm(path);
  for (const dir of plan.pruneDirs) {
    await deps.rmdir(dir).catch(() => undefined);
  }
  for (const file of plan.files) {
    await deps.mkdir(dirname(file.path));
    await deps.writeFile(file.path, file.content);
    await deps.chmod(file.path, file.mode);
  }
  for (const command of plan.commands) {
    try {
      await deps.execFile(command.cmd, command.args);
    } catch (error) {
      if (!command.optional) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      deps.note(code === 'ENOENT' ? `Skipped ${command.cmd}: not installed` : `${command.cmd} failed: ${(error as Error).message}`);
    }
  }
}

/** `<OVERDECK_HOME>/integrations`. */
export function integrationsDir(overdeckHome: string = getOverdeckHome()): string {
  return join(overdeckHome, 'integrations');
}

export function fileManagerStatePath(overdeckHome?: string): string {
  return join(integrationsDir(overdeckHome), 'file-manager.json');
}

/** The recorded install, or null when there is none or it is unreadable. */
export async function readFileManagerState(overdeckHome?: string): Promise<FileManagerState | null> {
  try {
    const parsed = JSON.parse(await readFile(fileManagerStatePath(overdeckHome), 'utf8')) as Partial<FileManagerState>;
    if (parsed.installed !== true || typeof parsed.panPath !== 'string' || !parsed.platform || !isFileManagerPlatform(parsed.platform)) {
      return null;
    }
    return {
      installed: true,
      platform: parsed.platform,
      panPath: parsed.panPath,
      at: typeof parsed.at === 'string' ? parsed.at : '',
      files: Array.isArray(parsed.files) ? parsed.files.filter((f): f is string => typeof f === 'string') : [],
      registryKeys: Array.isArray(parsed.registryKeys) ? parsed.registryKeys.filter((k): k is string => typeof k === 'string') : [],
    };
  } catch {
    return null;
  }
}

export async function writeFileManagerState(state: FileManagerState, overdeckHome?: string): Promise<void> {
  const path = fileManagerStatePath(overdeckHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function removeFileManagerState(overdeckHome?: string): Promise<void> {
  await rm(fileManagerStatePath(overdeckHome), { force: true });
}

/** An executable regular file. Sync on purpose: CLI-only code, never server-reachable. */
function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ResolvePanPathDeps {
  shimPath: string;
  pathEnv: string | undefined;
  isExecutable: (path: string) => boolean;
}

/**
 * The absolute `pan` every integration file runs. POSIX: the pan shim when it
 * is executable, else the first `pan` on PATH. Windows: the first `pan.cmd`
 * or `pan.exe` on PATH. Null when there is none.
 */
export function resolvePanPath(platform: FileManagerPlatform, overrides: Partial<ResolvePanPathDeps> = {}): string | null {
  const deps: ResolvePanPathDeps = {
    shimPath: join(panCliShimDir(), 'pan'),
    pathEnv: process.env.PATH,
    isExecutable: isExecutableFile,
    ...overrides,
  };
  if (platform === 'win32') {
    for (const segment of (deps.pathEnv ?? '').split(';')) {
      if (!segment) continue;
      for (const name of ['pan.cmd', 'pan.exe']) {
        const candidate = win32.join(segment, name);
        if (deps.isExecutable(candidate)) return candidate;
      }
    }
    return null;
  }
  if (deps.isExecutable(deps.shimPath)) return deps.shimPath;
  return findExecutableOnPath('pan', deps.pathEnv, { isExecutableFile: deps.isExecutable });
}

/** Copy the dashboard favicon next to the state file; its path, or null when the source is missing. */
export async function installIcon(overdeckHome?: string, source?: string): Promise<string | null> {
  const from = source ?? join(dirname(panCliBundlePath()), '..', 'dashboard', 'public', 'favicon.svg');
  const to = join(integrationsDir(overdeckHome), 'overdeck.svg');
  try {
    await access(from, fsConstants.R_OK);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    return to;
  } catch {
    return null;
  }
}
