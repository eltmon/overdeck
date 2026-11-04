/**
 * `pan doctor` check for the agent scratch root (PAN-4998). `du` is faster
 * than a Node walk on a large tree and exists on both Linux and macOS.
 */
import { execFile } from 'child_process';
import { access } from 'fs/promises';
import { promisify } from 'util';

import { getAgentTmpDir } from '../../lib/agent-tmpdir.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-inotify.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export const AGENT_TMP_WARN_BYTES = 10 * 1024 ** 3;

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

function formatBytes(bytes: number): string {
  return bytes >= GIB ? `${(bytes / GIB).toFixed(1)} GiB` : `${Math.round(bytes / MIB)} MiB`;
}

const execFileAsync = promisify(execFile);

async function defaultMeasureBytes(root: string): Promise<number> {
  const { stdout } = await execFileAsync('du', ['-sk', root], { timeout: 30_000 });
  return parseInt(stdout, 10) * 1024;
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface CheckAgentTmpOptions {
  root?: string;
  exists?: (path: string) => Promise<boolean>;
  measureBytes?: (path: string) => Promise<number>;
}

export async function checkAgentTmp(opts: CheckAgentTmpOptions = {}): Promise<CheckResult[]> {
  const root = opts.root ?? getAgentTmpDir();
  const exists = opts.exists ?? defaultExists;
  const measureBytes = opts.measureBytes ?? defaultMeasureBytes;
  const name = `Agent scratch (${root})`;

  if (!await exists(root)) {
    return [{ name, status: 'ok', message: 'not created yet' }];
  }

  let bytes: number;
  try {
    bytes = await measureBytes(root);
  } catch (error) {
    return [{ name, status: 'warn', message: `could not measure: ${error instanceof Error ? error.message : String(error)}` }];
  }

  const size = formatBytes(bytes);
  if (bytes > AGENT_TMP_WARN_BYTES) {
    return [{
      name,
      status: 'warn',
      message: `${size} in ${root} (over 10 GiB)`,
      fix: `The Deacon removes session directories idle for 14 days each hour; delete stale ones under ${root}/claude-<uid>/ by hand if the disk is full`,
    }];
  }
  return [{ name, status: 'ok', message: `${size} in ${root}` }];
}
