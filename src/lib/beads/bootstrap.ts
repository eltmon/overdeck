import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface BeadsBootstrapResult {
  remoteUrl: string;
  remoteRefPresent: boolean;
  bootstrapped: boolean;
}

export interface BeadsBootstrapDependencies {
  execute?: (file: string, args: readonly string[], cwd: string) => Promise<string>;
}

async function defaultExecute(file: string, args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(file, [...args], { cwd, encoding: 'utf8', timeout: 120_000 });
  return stdout.trim();
}

export function toDoltRemoteUrl(gitRemote: string): string {
  if (gitRemote.startsWith('git+')) return gitRemote;
  if (gitRemote.startsWith('ssh://')) return `git+${gitRemote}`;
  const scp = /^([^@\s]+@[^:/\s]+):(.+)$/.exec(gitRemote);
  if (scp) return `git+ssh://${scp[1]}/${scp[2]}`;
  return gitRemote;
}

/** Wire the project git remote as the Dolt transport and hydrate safely. */
export async function ensureProjectBeadsBootstrap(
  projectPath: string,
  beadsCwd = projectPath,
  dependencies: BeadsBootstrapDependencies = {},
): Promise<BeadsBootstrapResult> {
  const execute = dependencies.execute ?? defaultExecute;
  const gitRemote = (await execute('git', ['remote', 'get-url', 'origin'], projectPath)).trim();
  if (!gitRemote) throw new Error('Beads bootstrap is blocked because the project has no origin remote.');
  const remoteUrl = toDoltRemoteUrl(gitRemote);
  const remoteRef = await execute('git', ['ls-remote', 'origin', 'refs/dolt/data'], projectPath).catch(() => '');
  const remoteRefPresent = /^[0-9a-f]{40}\s+refs\/dolt\/data$/m.test(remoteRef);

  // bootstrap owns empty/missing DB recovery and schema adoption. On a remote
  // schema advance it re-clones; this path must never invoke bd migrate.
  await execute('bd', ['bootstrap', '--yes', '--json'], beadsCwd);
  const remotes = await execute('bd', ['dolt', 'remote', 'list', '--json'], beadsCwd).catch(() => '[]');
  let hasOrigin = false;
  try {
    const parsed = JSON.parse(remotes) as unknown;
    hasOrigin = JSON.stringify(parsed).includes('origin');
  } catch { /* add below */ }
  if (!hasOrigin) await execute('bd', ['dolt', 'remote', 'add', 'origin', remoteUrl], beadsCwd);

  const configured = await execute('bd', ['config', 'get', 'sync.remote'], beadsCwd).catch(() => '');
  if (configured.trim() && configured.trim() !== remoteUrl) {
    throw new Error(`Beads sync.remote points at ${configured.trim()}, but this project requires ${remoteUrl}. Writes are blocked until the remote is reconciled.`);
  }
  return { remoteUrl, remoteRefPresent, bootstrapped: true };
}
