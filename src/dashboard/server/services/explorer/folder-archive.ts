/**
 * Folder download as `.tar.gz` (PAN-5188, PRD §6.3 step 6, D-7).
 *
 * Spawns the system `tar` (GNU tar or bsdtar) so gigabytes never pack on the
 * dashboard event loop. Member names go in on stdin, NUL-separated (`--null
 * -T -`), so no name is ever parsed as an option. `tar` never gets `-h`:
 * symlinks are archived as links and never followed out of the root.
 *
 * The heavy, regenerable folders in WATCHER_IGNORE_DIRS are left out at any
 * depth, except the requested folder's own name (GNU tar would otherwise match
 * the leading component of every member and produce an empty archive).
 * `workspaces/` is also left out at the top of a project root.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { ExplorerRoot } from './roots.js';
import { WATCHER_IGNORE_DIRS } from './watch-ignore.js';

export interface FolderArchiveDeps {
  spawn: typeof nodeSpawn;
}

const STDERR_LOG_CHARS = 200;

/** The tar arguments and stdin members for archiving `abs` (exported for tests). */
export async function archivePlan(
  root: ExplorerRoot,
  abs: string,
): Promise<{ name: string; args: string[]; members: string[] }> {
  const name = basename(abs);
  const excludes = WATCHER_IGNORE_DIRS.filter((dir) => dir !== name);
  const atProjectTop = root.kind === 'project' && abs === root.absPath;
  const kept = (await readdir(abs))
    .filter((entry) => !excludes.includes(entry))
    .filter((entry) => !(atProjectTop && entry === 'workspaces'))
    .sort();
  const members = kept.length > 0 ? kept.map((entry) => `${name}/${entry}`) : [name];
  const args = [
    '-czf', '-',
    '-C', dirname(abs),
    ...excludes.map((dir) => `--exclude=${dir}`),
    ...(kept.length > 0 ? [] : ['--no-recursion']),
    '--null', '-T', '-',
  ];
  return { name, args, members };
}

/**
 * Stream `abs` as gzip-compressed tar bytes. Ending the iteration early (the
 * client disconnected) kills `tar`. A failing `tar` is logged; the response
 * status cannot change once bytes have been sent.
 */
export async function archiveFolder(
  root: ExplorerRoot,
  abs: string,
  deps: Partial<FolderArchiveDeps> = {},
): Promise<AsyncIterable<Uint8Array>> {
  const spawn = deps.spawn ?? nodeSpawn;
  const { args, members } = await archivePlan(root, abs);
  const child = spawn('tar', args, { stdio: ['pipe', 'pipe', 'pipe'] });

  let stderr = '';
  let cancelled = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < STDERR_LOG_CHARS) stderr += chunk;
  });
  child.on('error', (error) => console.error(`[explorer] tar failed to start: ${error.message}`));
  child.on('close', (code) => {
    if (code !== 0 && !cancelled) {
      console.error(`[explorer] tar exited ${code}: ${stderr.slice(0, STDERR_LOG_CHARS)}`);
    }
  });
  // tar may exit before reading all of stdin (a failure); EPIPE then is expected.
  child.stdin.on('error', () => {});
  child.stdin.end(members.map((member) => `${member}\0`).join(''));

  return (async function* bytes() {
    let finished = false;
    try {
      for await (const chunk of child.stdout) yield chunk as Uint8Array;
      finished = true;
    } finally {
      if (!finished && child.exitCode === null) {
        cancelled = true;
        child.kill('SIGTERM');
      }
    }
  })();
}
