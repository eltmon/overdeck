import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { packageRoot } from '../paths.js';
import { relocateVenvScripts } from './worktree-ops.js';

const execAsync = promisify(exec);

export interface TldrVenvDeps {
  exec: (cmd: string, opts?: { cwd?: string; timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
  exists: (path: string) => boolean;
  startDaemon: (workspacePath: string, venvPath: string) => Promise<void>;
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

/**
 * Set up TLDR code analysis for a workspace (after worktree creation to
 * ensure the directory is ready). TLDR setup is optional — errors are
 * reported as steps rather than thrown, so workspace creation never fails
 * because of it.
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
    // Check if python3 is available
    await execFn('python3 --version');
    const venvPath = join(workspacePath, '.venv');
    const tldrBin = join(venvPath, 'bin', 'tldr');

    // Check if main branch already has a working venv with llm-tldr
    const mainVenvTldr = join(projectPath, '.venv', 'bin', 'tldr');
    const mainVenvExists = exists(mainVenvTldr);

    if (exists(tldrBin)) {
      // PAN-4171: a resumed setup already has the venv; `cp -a` onto an
      // existing directory would nest a second copy inside it.
      steps.push('Python venv already present');
    } else if (mainVenvExists) {
      // Copy the entire venv from main — faster than pip install (seconds vs 30s+)
      const mainVenvPath = join(projectPath, '.venv');
      await execFn(`cp -a "${mainVenvPath}" "${venvPath}"`);
      // Python venvs are NOT relocatable: `cp -a` preserves the source venv's
      // absolute interpreter path in every bin/* shebang + activate script.
      // Rewrite the copy so each script points at the workspace venv's OWN
      // python — otherwise a repo rename breaks the TLDR MCP server + enforcer
      // (see relocateVenvScripts docstring).
      relocateVenvScripts(mainVenvPath, venvPath);
      steps.push('Copied Python venv from main branch (shebangs relocated)');
    } else {
      steps.push(...(await installTldrVenv(venvPath, deps)));
    }

    // Verify tldr binary exists after setup
    if (!exists(tldrBin)) {
      steps.push('TLDR setup incomplete: tldr binary not found after venv creation');
    } else {
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
    }
  } catch (error) {
    // TLDR setup is optional — don't fail workspace creation, but log clearly
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('python3')) {
      steps.push('Skipped TLDR setup (python3 not available)');
    } else {
      console.warn(`⚠ TLDR setup failed: ${message}`);
      steps.push(`TLDR setup failed: ${message}`);
    }
  }

  return steps;
}
