/**
 * TLDR Daemon Service
 *
 * Manages llm-tldr daemon lifecycle for project root and workspaces.
 * Provides code analysis and summarization for token-efficient agent work.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { PANOPTICON_HOME } from './paths.js';

const execAsync = promisify(exec);

/** Directory for TLDR daemon state files */
const TLDR_STATE_DIR = join(PANOPTICON_HOME, 'tldr');

/** Ensure TLDR state directory exists */
function ensureTldrStateDir(): void {
  if (!existsSync(TLDR_STATE_DIR)) {
    mkdirSync(TLDR_STATE_DIR, { recursive: true });
  }
}

/**
 * TLDR daemon state
 */
interface TldrDaemonState {
  running: boolean;
  pid?: number;
  startedAt?: string;
  workspacePath: string;
  venvPath: string;
}

/**
 * TLDR daemon status
 */
export interface TldrDaemonStatus {
  running: boolean;
  pid?: number;
  startedAt?: Date;
  workspacePath: string;
  venvPath: string;
  healthy: boolean;
}

/**
 * Hash workspace path to create a stable identifier
 */
function hashWorkspacePath(path: string): string {
  return createHash('sha256').update(path).digest('hex').substring(0, 16);
}

/**
 * Get state file path for a workspace
 */
function getStateFilePath(workspacePath: string): string {
  ensureTldrStateDir();
  const hash = hashWorkspacePath(workspacePath);
  const stateDir = join(TLDR_STATE_DIR, hash);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  return join(stateDir, 'daemon.json');
}

/**
 * Write daemon state to file
 */
function writeStateFile(workspacePath: string, venvPath: string, running: boolean, pid?: number): void {
  try {
    const stateFile = getStateFilePath(workspacePath);
    if (running) {
      const state: TldrDaemonState = {
        running: true,
        pid: pid || process.pid,
        startedAt: new Date().toISOString(),
        workspacePath,
        venvPath,
      };
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } else {
      if (existsSync(stateFile)) {
        unlinkSync(stateFile);
      }
    }
  } catch (error) {
    console.warn('Failed to write TLDR daemon state file:', error);
  }
}

/**
 * Read daemon state from file
 */
function readStateFile(workspacePath: string): TldrDaemonState | null {
  try {
    const stateFile = getStateFilePath(workspacePath);
    if (!existsSync(stateFile)) {
      return null;
    }

    const data = JSON.parse(readFileSync(stateFile, 'utf-8')) as TldrDaemonState;

    // Verify the process is still running
    if (data.pid) {
      try {
        process.kill(data.pid, 0); // Signal 0 checks if process exists
        return data;
      } catch {
        // Process doesn't exist - clean up stale state file
        unlinkSync(stateFile);
        return null;
      }
    }

    return data;
  } catch {
    // State file doesn't exist or is corrupted
    return null;
  }
}

/**
 * TLDR Daemon Service
 *
 * Manages llm-tldr daemons for project root and workspaces.
 */
export class TldrDaemonService {
  private workspacePath: string;
  private venvPath: string;

  /**
   * Create a new TLDR daemon service for a workspace
   *
   * @param workspacePath - Path to the workspace (project root or workspace directory)
   * @param venvPath - Path to the Python venv containing llm-tldr
   */
  constructor(workspacePath: string, venvPath: string) {
    this.workspacePath = workspacePath;
    this.venvPath = venvPath;
  }

  /**
   * Start the TLDR daemon
   *
   * @param background - Run daemon in background (default: true)
   */
  async start(background = true): Promise<void> {
    // Check if daemon is already running
    const currentState = readStateFile(this.workspacePath);
    if (currentState?.running) {
      console.warn(`TLDR daemon already running for ${this.workspacePath} (PID: ${currentState.pid})`);
      return;
    }

    // Verify venv and tldr binary exist
    const tldrBin = join(this.venvPath, 'bin', 'tldr');
    if (!existsSync(tldrBin)) {
      throw new Error(`tldr binary not found at ${tldrBin}. Ensure llm-tldr is installed in the venv.`);
    }

    console.log(`Starting TLDR daemon for ${this.workspacePath}...`);

    try {
      // Start daemon with project path
      const cmd = background
        ? `cd "${this.workspacePath}" && "${tldrBin}" daemon start --project "${this.workspacePath}" >/dev/null 2>&1 &`
        : `cd "${this.workspacePath}" && "${tldrBin}" daemon start --project "${this.workspacePath}"`;

      const { stdout, stderr } = await execAsync(cmd);

      if (stderr && !stderr.includes('started')) {
        console.warn(`TLDR daemon start warning: ${stderr}`);
      }

      // Give daemon a moment to start and write its PID file
      await new Promise(r => setTimeout(r, 500));

      // Try to get PID from tldr's status command
      let pid: number | undefined;
      try {
        const statusResult = await execAsync(`cd "${this.workspacePath}" && "${tldrBin}" daemon status`);
        const pidMatch = statusResult.stdout.match(/PID[:\s]+(\d+)/i);
        if (pidMatch) {
          pid = parseInt(pidMatch[1]);
        }
      } catch {
        // Status command failed - daemon might not expose PID
      }

      writeStateFile(this.workspacePath, this.venvPath, true, pid);
      console.log(`✓ TLDR daemon started for ${this.workspacePath}${pid ? ` (PID: ${pid})` : ''}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start TLDR daemon: ${errorMessage}`);
    }
  }

  /**
   * Stop the TLDR daemon
   */
  async stop(): Promise<void> {
    const currentState = readStateFile(this.workspacePath);
    if (!currentState?.running) {
      console.warn(`TLDR daemon not running for ${this.workspacePath}`);
      return;
    }

    const tldrBin = join(this.venvPath, 'bin', 'tldr');
    if (!existsSync(tldrBin)) {
      console.warn(`tldr binary not found at ${tldrBin}, cleaning up state file`);
      writeStateFile(this.workspacePath, this.venvPath, false);
      return;
    }

    console.log(`Stopping TLDR daemon for ${this.workspacePath}...`);

    try {
      // Stop daemon
      await execAsync(`cd "${this.workspacePath}" && "${tldrBin}" daemon stop`);

      writeStateFile(this.workspacePath, this.venvPath, false);
      console.log(`✓ TLDR daemon stopped for ${this.workspacePath}`);
    } catch (error) {
      // If stop fails, try to kill the process directly
      if (currentState.pid) {
        try {
          process.kill(currentState.pid, 'SIGTERM');
          console.log(`✓ Forcefully stopped TLDR daemon (PID: ${currentState.pid})`);
        } catch (killError) {
          console.warn(`Failed to kill TLDR daemon process: ${killError}`);
        }
      }

      // Clean up state file regardless
      writeStateFile(this.workspacePath, this.venvPath, false);
    }
  }

  /**
   * Get daemon status
   */
  async getStatus(): Promise<TldrDaemonStatus> {
    const state = readStateFile(this.workspacePath);

    if (!state?.running) {
      return {
        running: false,
        workspacePath: this.workspacePath,
        venvPath: this.venvPath,
        healthy: false,
      };
    }

    // Check health
    const healthy = await this.checkHealth();

    return {
      running: true,
      pid: state.pid,
      startedAt: state.startedAt ? new Date(state.startedAt) : undefined,
      workspacePath: this.workspacePath,
      venvPath: this.venvPath,
      healthy,
    };
  }

  /**
   * Check if daemon is healthy (can respond to status queries)
   */
  async checkHealth(): Promise<boolean> {
    const tldrBin = join(this.venvPath, 'bin', 'tldr');
    if (!existsSync(tldrBin)) {
      return false;
    }

    try {
      // Try to get daemon status
      await execAsync(`cd "${this.workspacePath}" && "${tldrBin}" daemon status`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restart the daemon
   */
  async restart(): Promise<void> {
    console.log(`Restarting TLDR daemon for ${this.workspacePath}...`);
    await this.stop();
    await new Promise(r => setTimeout(r, 1000)); // Wait for cleanup
    await this.start();
  }

  /**
   * Warm the index (trigger initial analysis)
   *
   * @param background - Run in background (default: true)
   */
  async warm(background = true): Promise<void> {
    const tldrBin = join(this.venvPath, 'bin', 'tldr');
    if (!existsSync(tldrBin)) {
      throw new Error(`tldr binary not found at ${tldrBin}`);
    }

    console.log(`Warming TLDR index for ${this.workspacePath}...`);

    try {
      const cmd = background
        ? `cd "${this.workspacePath}" && "${tldrBin}" index --all >/dev/null 2>&1 &`
        : `cd "${this.workspacePath}" && "${tldrBin}" index --all`;

      await execAsync(cmd);
      console.log(`✓ TLDR index warming initiated for ${this.workspacePath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to warm TLDR index: ${errorMessage}`);
    }
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    const state = readStateFile(this.workspacePath);
    return state?.running ?? false;
  }

  /**
   * Get workspace path
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * Get venv path
   */
  getVenvPath(): string {
    return this.venvPath;
  }
}

/**
 * Global registry of TLDR daemon services by workspace path
 */
const daemonRegistry = new Map<string, TldrDaemonService>();

/**
 * Get or create a TLDR daemon service for a workspace
 *
 * @param workspacePath - Path to the workspace
 * @param venvPath - Path to the Python venv
 */
export function getTldrDaemonService(workspacePath: string, venvPath: string): TldrDaemonService {
  const existing = daemonRegistry.get(workspacePath);
  if (existing) {
    return existing;
  }

  const service = new TldrDaemonService(workspacePath, venvPath);
  daemonRegistry.set(workspacePath, service);
  return service;
}

/**
 * Remove a daemon service from the registry
 *
 * @param workspacePath - Path to the workspace
 */
export function removeTldrDaemonService(workspacePath: string): void {
  daemonRegistry.delete(workspacePath);
}

/**
 * List all registered daemon services
 */
export function listTldrDaemonServices(): TldrDaemonService[] {
  return Array.from(daemonRegistry.values());
}
