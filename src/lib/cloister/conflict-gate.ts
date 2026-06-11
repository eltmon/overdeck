import { exec, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

export type BranchMergeability = 'clean' | 'conflicts' | 'unknown';

export interface ExecResult {
  stdout: string | Buffer;
  stderr: string | Buffer;
}

export type ExecRunner = (command: string, options: ExecOptions) => Promise<ExecResult>;

export interface CheckBranchMergeabilityDeps {
  exec?: ExecRunner;
}

/**
 * Non-destructively checks whether HEAD can merge with origin/<targetBranch>.
 * Uses git merge-tree only — never git merge — so HEAD, the index, and the
 * working tree are left untouched.
 */
export async function checkBranchMergeability(
  workspacePath: string,
  targetBranch: string,
  deps: CheckBranchMergeabilityDeps = {},
): Promise<BranchMergeability> {
  const run = deps.exec ?? execAsync;
  const options: ExecOptions = {
    cwd: workspacePath,
    encoding: 'utf-8',
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  };

  try {
    await run(`git fetch origin ${shellQuote(targetBranch)}`, options);
  } catch {
    return 'unknown';
  }

  try {
    const result = await run(
      `git merge-tree --write-tree --name-only HEAD ${shellQuote(`origin/${targetBranch}`)}`,
      options,
    );
    return outputHasConflictMarker(result.stdout, result.stderr) ? 'conflicts' : 'clean';
  } catch (err) {
    return mergeTreeFailureIndicatesConflict(err) ? 'conflicts' : 'unknown';
  }
}

function mergeTreeFailureIndicatesConflict(err: unknown): boolean {
  const maybe = err as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
  const output = [maybe.stdout, maybe.stderr, maybe.message].map(toText).join('\n');

  if (outputHasConflictMarker(output, '')) return true;

  // `git merge-tree --write-tree` exits 1 for merge conflicts. Treat fatal/git
  // usage failures as unknown so missing workspaces, old git, and bad refs do not
  // masquerade as real branch conflicts.
  return maybe.code === 1 && !/\b(fatal|usage:|unknown option|not a git repository)\b/i.test(output);
}

function outputHasConflictMarker(stdout: unknown, stderr: unknown): boolean {
  const output = `${toText(stdout)}\n${toText(stderr)}`;
  return /\bCONFLICT\b/i.test(output) || /contains conflicts/i.test(output);
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  if (value instanceof Error) return value.message;
  return value == null ? '' : String(value);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/@:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
