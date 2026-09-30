/**
 * Directive project detection (PAN-3943 WI-4): read-only signals that a repo
 * holds a Deft Directive deposit (`directive init` output).
 *
 * Detection is derived on every call and never stored. It reads files only;
 * the single child process is `git config --get core.hooksPath`, and it runs
 * only when a file signal already marks a Directive project, so a plain
 * project launch spawns nothing. Nothing here writes.
 */
import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** First line of a `.deft-directive-disable` flag that Overdeck wrote (PAN-3943 D7). */
export const DEFT_FLAG_MARKER = '# overdeck:deft-directive-disable';
export const DEFT_FLAG_FILE = '.deft-directive-disable';
/** First engine release whose policy module honors the flag file (upstream #3039). */
const DEFT_KILL_SWITCH_MIN_VERSION = [0, 92, 0] as const;

const DEFT_ENGINE_PACKAGE = '@deftai/directive';
const POINTER_SKILL_PREFIX = 'deft-directive-';
const AGENT_HOOK_FILES = ['.claude/settings.json', '.codex/hooks.json', '.cursor/hooks.json', '.grok/hooks/deft.json'];
const POINTER_SKILL_DIRS = ['.claude/skills', '.agents/skills', '.codex/skills'];
const MANAGED_SECTION = /<!--\s*deft:managed-section\b[ \t]*([^\s>-][^\s>]*)?/;
const GIT_TIMEOUT_MS = 5000;

export interface DirectiveDetection {
  root: string;
  isDirectiveProject: boolean;
  /** First line of `.deft/core/VERSION`. */
  coreVersion: string | null;
  /** `package.json` devDependencies (else dependencies) `@deftai/directive`. */
  pinnedEngine: string | null;
  /** Version token of the `<!-- deft:managed-section v3 -->` marker in AGENTS.md, e.g. `v3`. */
  managedSection: string | null;
  /** Agent hook files whose text contains `deft-hook`. */
  agentHookFiles: string[];
  /** `git config --get core.hooksPath`; null when unset, failed, or not a Directive project. */
  gitHooksPath: string | null;
  /** `.githooks/pre-commit` exists. */
  hasGithooksDir: boolean;
  /** Sorted unique `deft-directive-*` skill dir names under the harness skill dirs. */
  pointerSkills: string[];
  /** `xbrief/PROJECT-DEFINITION.xbrief.json` exists. */
  xbriefProjectDefinition: boolean;
  killSwitch: { present: boolean; overdeckOwned: boolean };
  /** `.no-deft-directive` exists (committed permanent opt-out). */
  permanentOptOut: boolean;
  /** Engine version (coreVersion, else pinnedEngine) is at least 0.92.0; null when neither parses. */
  killSwitchSupported: boolean | null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isFile()) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0] ?? '';
}

async function readCoreVersion(root: string): Promise<string | null> {
  const text = await readTextOrNull(join(root, '.deft', 'core', 'VERSION'));
  const line = text === null ? '' : firstLine(text).trim();
  return line || null;
}

async function readPinnedEngine(root: string): Promise<string | null> {
  const text = await readTextOrNull(join(root, 'package.json'));
  if (text === null) return null;
  try {
    const pkg: unknown = JSON.parse(text);
    if (!pkg || typeof pkg !== 'object') return null;
    for (const field of ['devDependencies', 'dependencies']) {
      const deps = (pkg as Record<string, unknown>)[field];
      if (!deps || typeof deps !== 'object') continue;
      const pin = (deps as Record<string, unknown>)[DEFT_ENGINE_PACKAGE];
      if (typeof pin === 'string' && pin.trim()) return pin.trim();
    }
  } catch {
    return null;
  }
  return null;
}

async function readManagedSection(root: string): Promise<string | null> {
  const text = await readTextOrNull(join(root, 'AGENTS.md'));
  const match = text?.match(MANAGED_SECTION);
  if (!match) return null;
  return match[1] ?? 'unversioned';
}

async function readAgentHookFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of AGENT_HOOK_FILES) {
    if ((await readTextOrNull(join(root, file)))?.includes('deft-hook')) found.push(file);
  }
  return found;
}

async function readPointerSkills(root: string): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of POINTER_SKILL_DIRS) {
    let dirents;
    try {
      dirents = await readdir(join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (dirent.name.startsWith(POINTER_SKILL_PREFIX) && (dirent.isDirectory() || dirent.isSymbolicLink())) {
        names.add(dirent.name);
      }
    }
  }
  return [...names].sort();
}

async function readGitHooksPath(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'config', '--get', 'core.hooksPath'], {
      timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** `major.minor.patch` after stripping a leading `^`, `~`, `=`, or `v`; null for prereleases and ranges. */
function parseEngineVersion(value: string | null): [number, number, number] | null {
  const match = value?.trim().match(/^[\^~=v]*(\d+)\.(\d+)\.(\d+)$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function atLeast(version: readonly number[], floor: readonly number[]): boolean {
  for (let i = 0; i < floor.length; i++) {
    if (version[i] !== floor[i]) return (version[i] ?? 0) > (floor[i] ?? 0);
  }
  return true;
}

export async function detectDirectiveProject(root: string): Promise<DirectiveDetection> {
  const [coreVersion, pinnedEngine, managedSection] = await Promise.all([
    readCoreVersion(root),
    readPinnedEngine(root),
    readManagedSection(root),
  ]);
  const isDirectiveProject = coreVersion !== null || managedSection !== null || pinnedEngine !== null;
  const [agentHookFiles, gitHooksPath, hasGithooksDir, pointerSkills, xbriefProjectDefinition, flag, permanentOptOut] =
    await Promise.all([
      readAgentHookFiles(root),
      isDirectiveProject ? readGitHooksPath(root) : Promise.resolve(null),
      exists(join(root, '.githooks', 'pre-commit')),
      readPointerSkills(root),
      exists(join(root, 'xbrief', 'PROJECT-DEFINITION.xbrief.json')),
      readTextOrNull(join(root, DEFT_FLAG_FILE)),
      exists(join(root, '.no-deft-directive')),
    ]);
  const version = parseEngineVersion(coreVersion) ?? parseEngineVersion(pinnedEngine);
  return {
    root,
    isDirectiveProject,
    coreVersion,
    pinnedEngine,
    managedSection,
    agentHookFiles,
    gitHooksPath,
    hasGithooksDir,
    pointerSkills,
    xbriefProjectDefinition,
    killSwitch: {
      present: flag !== null || (await exists(join(root, DEFT_FLAG_FILE))),
      overdeckOwned: flag !== null && firstLine(flag) === DEFT_FLAG_MARKER,
    },
    permanentOptOut,
    killSwitchSupported: version ? atLeast(version, DEFT_KILL_SWITCH_MIN_VERSION) : null,
  };
}

/** The first directory at or above `cwd` holding a `.git` entry (file or dir); `cwd` when none. */
export async function findRepoRoot(cwd: string): Promise<string> {
  const start = resolve(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    if (await exists(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return start;
  }
}
