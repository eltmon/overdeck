import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PortEvictionResult {
  pids: number[];
  error: string | null;
}

/** Evict a health-verified foreign dashboard from the primary API port. */
export async function evictPortHolders(port: number): Promise<PortEvictionResult> {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('fuser', [`${port}/tcp`], { encoding: 'utf8' }));
  } catch (error) {
    stdout = (error as { stdout?: string }).stdout ?? '';
  }

  const pids = stdout
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
  if (pids.length === 0) return { pids: [], error: `no holder PID found for port ${port}` };

  try {
    for (const pid of pids) process.kill(pid, 'SIGTERM');
    return { pids, error: null };
  } catch (error) {
    return { pids, error: error instanceof Error ? error.message : String(error) };
  }
}
