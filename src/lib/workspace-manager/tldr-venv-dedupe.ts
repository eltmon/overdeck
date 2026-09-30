import { existsSync, readdirSync } from 'fs';
import { lstat, rename, rm } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PYTHON_PROJECT_MARKERS, linkWorkspaceTldrVenv, ensureVenvExcluded } from './tldr-venv.js';

const execAsync = promisify(exec);

export interface DedupeEntry {
  workspacePath: string;
  bytes: number;
  action: 'converted' | 'would-convert' | 'skipped';
  reason?: string;
}

interface DedupeDaemon {
  stop: () => Promise<void>;
  start: (background?: boolean) => Promise<void>;
}

export interface DedupeDeps {
  du: (path: string) => Promise<number>;
  getDaemon: (workspacePath: string, venvPath: string) => Promise<DedupeDaemon>;
}

async function defaultDu(path: string): Promise<number> {
  const { stdout } = await execAsync(`du -sb "${path}"`);
  const bytes = Number.parseInt(stdout.split('\t')[0] ?? '0', 10);
  return Number.isFinite(bytes) ? bytes : 0;
}

async function defaultGetDaemon(workspacePath: string, venvPath: string): Promise<DedupeDaemon> {
  const { getTldrDaemonService } = await import('../tldr-daemon.js');
  return getTldrDaemonService(workspacePath, venvPath);
}

/**
 * Convert every legacy `cp -a` workspace venv copy under
 * `<projectRoot>/workspaces/feature-*` into a symlink to the project-root
 * venv (PAN-1674). Never shells out to `rm` — the old directory is removed
 * with Node's `fs.promises.rm`.
 */
export async function dedupeWorkspaceVenvs(
  projectRoot: string,
  opts: { dryRun: boolean },
  deps: Partial<DedupeDeps> = {}
): Promise<DedupeEntry[]> {
  const du = deps.du ?? defaultDu;
  const getDaemon = deps.getDaemon ?? defaultGetDaemon;

  const projectVenvPath = join(projectRoot, '.venv');
  if (!existsSync(join(projectVenvPath, 'bin', 'tldr'))) {
    throw new Error(`No project-root venv at ${projectVenvPath}; run \`pan admin tldr install\` first.`);
  }

  const entries: DedupeEntry[] = [];
  const workspacesDir = join(projectRoot, 'workspaces');
  if (!existsSync(workspacesDir)) {
    return entries;
  }

  const workspaceNames = readdirSync(workspacesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('feature-'))
    .map((entry) => entry.name);

  for (const name of workspaceNames) {
    const workspacePath = join(workspacesDir, name);
    const venvPath = join(workspacePath, '.venv');

    let stats;
    try {
      stats = await lstat(venvPath);
    } catch {
      continue; // no .venv — nothing to dedupe
    }

    if (stats.isSymbolicLink()) {
      continue; // already a shared link
    }
    if (!stats.isDirectory()) {
      continue; // not a venv we recognize
    }

    const hasPythonProjectMarker = PYTHON_PROJECT_MARKERS.some((marker) => existsSync(join(workspacePath, marker)));
    if (hasPythonProjectMarker) {
      entries.push({ workspacePath, bytes: 0, action: 'skipped', reason: 'workspace is a Python project that owns .venv' });
      continue;
    }

    if (!existsSync(join(venvPath, 'bin', 'tldr'))) {
      entries.push({ workspacePath, bytes: 0, action: 'skipped', reason: 'real directory without bin/tldr' });
      continue;
    }

    const bytes = await du(venvPath);

    if (opts.dryRun) {
      entries.push({ workspacePath, bytes, action: 'would-convert' });
      continue;
    }

    const daemon = await getDaemon(workspacePath, venvPath);
    try {
      await daemon.stop();
    } catch {
      // Non-fatal — proceed with the conversion regardless.
    }

    const oldPath = `${venvPath}.pan-1674-old`;
    try {
      await rename(venvPath, oldPath);
      linkWorkspaceTldrVenv(workspacePath, projectVenvPath);
      await ensureVenvExcluded(workspacePath);
      await rm(oldPath, { recursive: true, force: true });
      entries.push({ workspacePath, bytes, action: 'converted' });
    } catch (error) {
      if (existsSync(oldPath) && !existsSync(venvPath)) {
        try {
          await rename(oldPath, venvPath);
        } catch {
          // Best-effort rollback only.
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      entries.push({ workspacePath, bytes, action: 'skipped', reason: message });
      continue;
    }

    try {
      const restartedDaemon = await getDaemon(workspacePath, venvPath);
      await restartedDaemon.start(true);
    } catch {
      // Non-fatal — the workspace still ends up with a working shared venv.
    }
  }

  return entries;
}
