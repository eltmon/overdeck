import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const GH_GRAPHQL_RETRY_DELAY_MS = 1000;
export const GH_GRAPHQL_STDERR_LIMIT = 500;

export type GhExec = (args: string[]) => Promise<{ stdout: string }>;
export type Delay = (ms: number) => Promise<void>;

interface GhExecFailure {
  code?: number | string | null;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

function defaultExec(args: string[]): Promise<{ stdout: string }> {
  return execFileAsync('gh', args, {
    encoding: 'utf-8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Render a gh exec failure for operator eyes without the 50-alias query. */
export function describeGhGraphqlFailure(error: unknown, attempt: number): string {
  const { code, killed, stderr } = (error ?? {}) as GhExecFailure;
  const exitLabel = killed || code == null ? 'timeout' : `exit ${code}`;
  const trimmedStderr = typeof stderr === 'string' ? stderr.trim() : '';
  const detail = trimmedStderr.length > 0
    ? trimmedStderr.slice(0, GH_GRAPHQL_STDERR_LIMIT)
    : 'no stderr';
  return `gh api graphql failed (${exitLabel}, attempt ${attempt}): ${detail}`;
}

export async function runGitHubGraphql(
  query: string,
  exec: GhExec = defaultExec,
  delay: Delay = defaultDelay,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { stdout } = await exec(['api', 'graphql', '-f', `query=${query}`]);
      return stdout;
    } catch (error) {
      // gh exits non-zero when the GraphQL envelope carries per-field errors
      // (e.g. `issue(number: N)` where N is a PR — strike branches can point at
      // PR numbers), but it still prints the full response with partial data to
      // stdout. Surface that envelope so callers can use the resolvable fields
      // instead of failing the whole gather (the zero-membership regression).
      const stdout = (error as { stdout?: string }).stdout;
      let parsedEnvelope = false;
      if (typeof stdout === 'string' && stdout.length > 0) {
        try {
          const parsed = JSON.parse(stdout) as { data?: unknown };
          parsedEnvelope = true;
          if (parsed.data !== undefined && parsed.data !== null) return stdout;
        } catch {
          // stdout is not a GraphQL envelope — retry-eligible below
        }
      }
      // A parsed errors-only envelope (bad query, rate limit) is deterministic
      // and retrying burns quota; an unparseable stdout (network failure, gh
      // crash, timeout) is the intermittent class this retries once for.
      if (parsedEnvelope || attempt > 1) {
        throw new Error(describeGhGraphqlFailure(error, attempt), { cause: error });
      }
      await delay(GH_GRAPHQL_RETRY_DELAY_MS);
    }
  }
}
