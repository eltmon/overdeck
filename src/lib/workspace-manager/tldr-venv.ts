import { existsSync, readFileSync, appendFileSync, mkdirSync, symlinkSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { packageRoot } from '../paths.js';

const execAsync = promisify(exec);

export const PYTHON_PROJECT_MARKERS = ['pyproject.toml', 'requirements.txt', 'Pipfile', 'setup.py'] as const;

export interface TldrVenvDeps {
  exec: (cmd: string, opts?: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
  exists: (path: string) => boolean;
  startDaemon: (workspacePath: string, venvPath: string) => Promise<void>;
  symlink: (target: string, path: string) => void;
  readFile: (path: string) => string;
  appendFile: (path: string, content: string) => void;
  gitPath: (cwd: string) => Promise<string>;
}

async function defaultStartDaemon(workspacePath: string, venvPath: string): Promise<void> {
  const { getTldrDaemonService } = await import('../tldr-daemon.js');
  const tldrService = getTldrDaemonService(workspacePath, venvPath);
  await tldrService.start(true);
  try {
    await tldrService.warm(true); // background=true: non-blocking
  } catch {
    // Non-fatal — daemon may not support warm yet
  }
}

function defaultSymlink(target: string, linkPath: string): void {
  symlinkSync(target, linkPath, 'dir');
}

function defaultReadFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function defaultAppendFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, content);
}

async function defaultGitPath(cwd: string): Promise<string> {
  const { stdout } = await execAsync('git rev-parse --git-path info/exclude', { cwd });
  const output = stdout.trim();
  return isAbsolute(output) ? output : resolve(cwd, output);
}

/**
 * Build a fresh venv and install llm-tldr. CPU-only torch FIRST (PAN-3534):
 * llm-tldr hard-depends on sentence-transformers -> torch, and the default GPU
 * wheel drags in ~6.85GB of nvidia/triton/cuda per venv that nothing here uses
 * (warm and the read-enforcer are CPU background work). Pre-installing the CPU
 * wheel satisfies the dependency and keeps the venv under 1GB.
 */
export async function installTldrVenv(venvPath: string, deps: Partial<TldrVenvDeps> = {}): Promise<string[]> {
  const execFn = deps.exec ?? execAsync;
  const exists = deps.exists ?? existsSync;
  const steps: string[] = [];
  const cwd = dirname(venvPath);

  await execFn(`python3 -m venv "${venvPath}"`, { cwd });
  const pipPath = join(venvPath, 'bin', 'pip');
  await execFn(`"${pipPath}" install torch --index-url https://download.pytorch.org/whl/cpu`, {
    cwd,
    timeout: 300000,
  });
  await execFn(`"${pipPath}" install llm-tldr`, { cwd, timeout: 300000 });
  steps.push('Created Python venv and installed llm-tldr (CPU-only torch)');

  // Apply .tsx/.jsx support patch (upstream llm-tldr only checks .ts)
  const patchScript = join(packageRoot, 'scripts', 'patches', 'llm-tldr-tsx-support.py');
  if (exists(patchScript)) {
    await execFn(`python3 "${patchScript}" "${venvPath}"`);
    steps.push('Applied llm-tldr .tsx/.jsx patch');
  }

  return steps;
}

/** Symlink a workspace's `.venv` to the shared project-root venv. */
export function linkWorkspaceTldrVenv(
  workspacePath: string,
  projectVenvPath: string,
  deps: Partial<TldrVenvDeps> = {}
): void {
  const symlink = deps.symlink ?? defaultSymlink;
  symlink(projectVenvPath, join(workspacePath, '.venv'));
}

/**
 * Add `/.venv` to the repository's common-dir exclude file (never the
 * tracked .gitignore — see src/lib/projects/create-perform.ts
 * excludeWorkspacesDir), so the shared-venv symlink never shows as untracked
 * in any worktree. Idempotent: a pre-existing `/.venv` or `.venv` line (but
 * not `.venv/`, which does not match a symlink) is left alone. Failures are
 * non-fatal.
 */
export async function ensureVenvExcluded(workspacePath: string, deps: Partial<TldrVenvDeps> = {}): Promise<boolean> {
  const gitPath = deps.gitPath ?? defaultGitPath;
  const readFile = deps.readFile ?? defaultReadFile;
  const appendFile = deps.appendFile ?? defaultAppendFile;

  try {
    const excludePath = await gitPath(workspacePath);
    const content = readFile(excludePath);
    const alreadyExcluded = content
      .split('\n')
      .map((line) => line.trim())
      .some((line) => line === '/.venv' || line === '.venv');
    if (alreadyExcluded) {
      return false;
    }

    const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
    appendFile(excludePath, `${needsLeadingNewline ? '\n' : ''}/.venv\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Set up TLDR code analysis for a workspace (after worktree creation to
 * ensure the directory is ready). TLDR setup is optional — errors are
 * reported as steps rather than thrown, so workspace creation never fails
 * because of it. Workspace creation never builds or copies a venv: it links
 * to the project-root venv (built once via `pan admin tldr install`).
 */
export async function setupWorkspaceTldr(
  workspacePath: string,
  projectPath: string,
  deps: Partial<TldrVenvDeps> = {}
): Promise<string[]> {
  const execFn = deps.exec ?? execAsync;
  const exists = deps.exists ?? existsSync;
  const startDaemon = deps.startDaemon ?? defaultStartDaemon;
  const steps: string[] = [];

  try {
    const venvPath = join(workspacePath, '.venv');
    const tldrBin = join(venvPath, 'bin', 'tldr');

    if (exists(tldrBin)) {
      // PAN-4171: a resumed setup, or a workspace whose venv is already
      // linked, already has a working tldr binary.
      steps.push('Python venv already present');
    } else {
      const hasPythonProjectMarker = PYTHON_PROJECT_MARKERS.some((marker) => exists(join(workspacePath, marker)));
      if (hasPythonProjectMarker) {
        // A linked venv would let a `pip install`/`uv sync` inside this
        // workspace write into the venv every workspace shares.
        steps.push('Skipped TLDR venv link: workspace is a Python project that owns .venv');
        return steps;
      }

      const projectVenvPath = join(projectPath, '.venv');
      if (!exists(join(projectVenvPath, 'bin', 'tldr'))) {
        steps.push(`Skipped TLDR setup: no project-root venv; run \`pan admin tldr install\` in ${projectPath}`);
        return steps;
      }

      linkWorkspaceTldrVenv(workspacePath, projectVenvPath, deps);
      await ensureVenvExcluded(workspacePath, deps);
      steps.push(`Linked .venv to shared project venv ${projectVenvPath}`);
    }

    // Copy .tldr index from main branch if it exists
    const mainTldrDir = join(projectPath, '.tldr');
    const workspaceTldrDir = join(workspacePath, '.tldr');

    if (exists(mainTldrDir) && !exists(workspaceTldrDir)) {
      await execFn(`cp -r "${mainTldrDir}" "${workspaceTldrDir}"`);
      steps.push('Copied TLDR index from main branch');
    }

    // Start TLDR daemon for this workspace, then warm the index in the
    // background — ensures workspaces always have a working index even
    // when the main branch cache was empty (nothing to copy).
    await startDaemon(workspacePath, venvPath);
    steps.push('Started TLDR daemon');
    steps.push('TLDR index warm initiated (background)');
  } catch (error) {
    // TLDR setup is optional — don't fail workspace creation, but log clearly
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠ TLDR setup failed: ${message}`);
    steps.push(`TLDR setup failed: ${message}`);
  }

  return steps;
}
