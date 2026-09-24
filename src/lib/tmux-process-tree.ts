import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const KEEPALIVE_FOREGROUND_COMMANDS = new Set(['sleep', 'bash', 'sh', 'dash', 'zsh', 'ash']);

/**
 * True when a pane process tree contains a real harness rather than only the
 * launcher shell and its keep-alive sleep loop. `psTable` is `ps -eo
 * pid=,ppid=,comm=` output.
 */
export function paneTreeHasHarnessProcess(panePids: number[], psTable: string): boolean {
  const childrenByPpid = new Map<number, number[]>();
  const commByPid = new Map<number, string>();
  for (const line of psTable.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    commByPid.set(pid, match[3].trim());
    const siblings = childrenByPpid.get(ppid);
    if (siblings) siblings.push(pid);
    else childrenByPpid.set(ppid, [pid]);
  }
  const queue = [...panePids];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const comm = commByPid.get(pid);
    if (comm && !KEEPALIVE_FOREGROUND_COMMANDS.has(comm)) return true;
    const children = childrenByPpid.get(pid);
    if (children) queue.push(...children);
  }
  return false;
}

/** The `ps -eo pid=,ppid=,comm=` table {@link paneTreeHasHarnessProcess} reads; rejects when `ps` fails. */
export async function readProcessTable(): Promise<string> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf-8' });
  return String(stdout);
}
