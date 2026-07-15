import { execFile } from 'node:child_process';

export const BUILD_INPUT_PATHS = [
  'src',
  'packages',
  'package.json',
  'bun.lock',
  'tsdown.config.ts',
] as const;

export interface BuildStaleness {
  readonly status: 'fresh' | 'stale' | 'unknown';
  readonly buildCommit: string | null;
  readonly originMainSha: string | null;
  readonly behindTotal: number | null;
  readonly behindBuildInputs: number | null;
  readonly originMainLastCommitAt: number | null;
  readonly computedAt: number;
  readonly reason?: string;
}

export type GitExec = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<{ readonly stdout: string }>;

const DEFAULT_FETCH_MIN_INTERVAL_MS = 120_000;
const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const lastFetchAttemptByRepo = new Map<string, number>();

const defaultExec: GitExec = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], {
      cwd: options.cwd,
      encoding: 'utf8',
      timeout: DEFAULT_GIT_TIMEOUT_MS,
      killSignal: 'SIGTERM',
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout });
    });
  });

async function fetchOriginMain(
  run: GitExec,
  repoRoot: string,
  timeoutMs: number,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      run('git', ['fetch', 'origin', 'main'], { cwd: repoRoot }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`git fetch timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function unknown(
  buildCommit: string | null,
  computedAt: number,
  reason: string,
  originMainSha: string | null = null,
): BuildStaleness {
  return {
    status: 'unknown',
    buildCommit,
    originMainSha,
    behindTotal: null,
    behindBuildInputs: null,
    originMainLastCommitAt: null,
    computedAt,
    reason,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function computeBuildStaleness(input: {
  readonly repoRoot: string;
  readonly buildCommit: string | null;
  readonly exec?: GitExec;
  readonly fetchMinIntervalMs?: number;
  readonly fetchTimeoutMs?: number;
}): Promise<BuildStaleness> {
  const computedAt = Date.now();
  const { repoRoot, buildCommit } = input;
  const run = input.exec ?? defaultExec;

  if (!buildCommit) {
    return unknown(buildCommit, computedAt, 'The running build does not include a commit stamp.');
  }

  try {
    await run('git', ['rev-parse', '--verify', `${buildCommit}^{commit}`], { cwd: repoRoot });
  } catch (error) {
    return unknown(buildCommit, computedAt, `The build commit is not available in this repository: ${errorMessage(error)}`);
  }

  const fetchMinIntervalMs = input.fetchMinIntervalMs ?? DEFAULT_FETCH_MIN_INTERVAL_MS;
  const lastFetchAttempt = lastFetchAttemptByRepo.get(repoRoot) ?? Number.NEGATIVE_INFINITY;
  if (computedAt - lastFetchAttempt >= fetchMinIntervalMs) {
    lastFetchAttemptByRepo.set(repoRoot, computedAt);
    try {
      await fetchOriginMain(run, repoRoot, input.fetchTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
    } catch {
      // A stale local origin/main is still more useful than rejecting the health check.
    }
  }

  let originMainSha: string | null = null;
  try {
    originMainSha = (await run('git', ['rev-parse', 'origin/main'], { cwd: repoRoot })).stdout.trim();
    const range = `${buildCommit}..origin/main`;
    const [total, buildInputs, lastCommit] = await Promise.all([
      run('git', ['rev-list', '--count', range], { cwd: repoRoot }),
      run('git', ['rev-list', '--count', range, '--', ...BUILD_INPUT_PATHS], { cwd: repoRoot }),
      run('git', ['log', '-1', '--format=%ct', 'origin/main'], { cwd: repoRoot }),
    ]);
    const behindTotal = Number.parseInt(total.stdout.trim(), 10);
    const behindBuildInputs = Number.parseInt(buildInputs.stdout.trim(), 10);
    const originMainLastCommitAt = Number.parseInt(lastCommit.stdout.trim(), 10) * 1000;

    if (![behindTotal, behindBuildInputs, originMainLastCommitAt].every(Number.isFinite)) {
      return unknown(buildCommit, computedAt, 'Git returned invalid staleness metadata.', originMainSha);
    }

    return {
      status: behindBuildInputs > 0 ? 'stale' : 'fresh',
      buildCommit,
      originMainSha,
      behindTotal,
      behindBuildInputs,
      originMainLastCommitAt,
      computedAt,
    };
  } catch (error) {
    return unknown(buildCommit, computedAt, `Unable to compute build staleness: ${errorMessage(error)}`, originMainSha);
  }
}

export function _resetForTests(): void {
  lastFetchAttemptByRepo.clear();
}
