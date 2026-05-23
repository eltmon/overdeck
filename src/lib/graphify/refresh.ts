import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type RefreshResult =
  | { skipped: 'no-graphify-cli' | 'no-graphify-out' | 'no-changes' | 'gitignored' }
  | { ok: true; commit: string; pushed: boolean }
  | { ok: false; error: string };

export async function refreshGraphify(projectPath: string, issueId: string): Promise<RefreshResult> {
  try {
    await execAsync('which graphify', { cwd: projectPath, encoding: 'utf-8' });
  } catch {
    return { skipped: 'no-graphify-cli' };
  }

  if (!existsSync(join(projectPath, 'graphify-out'))) {
    return { skipped: 'no-graphify-out' };
  }

  try {
    await execAsync('graphify update .', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      return { ok: false, error: 'graphify update timed out' };
    }
    return { ok: false, error: `graphify update failed: ${formatExecError(error)}` };
  }

  try {
    await execAsync('git add graphify-out/', { cwd: projectPath, encoding: 'utf-8' });
  } catch (error) {
    return { ok: false, error: `git add graphify-out/ failed: ${formatExecError(error)}` };
  }

  const stagedGraphifyChanges = await hasStagedGraphifyChanges(projectPath);
  if (stagedGraphifyChanges.ok === false) {
    return stagedGraphifyChanges;
  }
  if (!stagedGraphifyChanges.hasChanges) {
    return { skipped: 'no-changes' };
  }

  try {
    await execAsync(`git commit -m ${shellQuote(`chore(graphify): refresh after ${issueId}`)} -- graphify-out/`, {
      cwd: projectPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    return { ok: false, error: `git commit graphify-out/ failed: ${formatExecError(error)}` };
  }

  const pushResult = await pushGraphifyCommit(projectPath);
  if (!pushResult.ok) {
    return pushResult;
  }

  try {
    const result = await execAsync('git rev-parse HEAD', { cwd: projectPath, encoding: 'utf-8' });
    return { ok: true, commit: result.stdout.trim(), pushed: true };
  } catch (error) {
    return { ok: false, error: `git rev-parse HEAD failed: ${formatExecError(error)}` };
  }
}

async function hasStagedGraphifyChanges(projectPath: string): Promise<{ ok: true; hasChanges: boolean } | { ok: false; error: string }> {
  try {
    await execAsync('git diff --cached --quiet -- graphify-out/', { cwd: projectPath, encoding: 'utf-8' });
    return { ok: true, hasChanges: false };
  } catch (error) {
    if (getErrorCode(error) === 1) {
      return { ok: true, hasChanges: true };
    }
    return { ok: false, error: `git diff --cached --quiet -- graphify-out/ failed: ${formatExecError(error)}` };
  }
}

async function pushGraphifyCommit(projectPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await execAsync('git push origin main', {
      cwd: projectPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true };
  } catch (error) {
    if (!isNonFastForwardError(error)) {
      return { ok: false, error: `push failed: ${formatExecError(error)}` };
    }
  }

  try {
    await execAsync('git fetch origin main', {
      cwd: projectPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    return { ok: false, error: `push failed: ${formatExecError(error)}` };
  }

  try {
    await execAsync('git pull --rebase origin main', {
      cwd: projectPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    await abortRebase(projectPath);
    return { ok: false, error: `push failed: ${formatExecError(error)}` };
  }

  try {
    await execAsync('git push origin main', {
      cwd: projectPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `push failed: ${formatExecError(error)}` };
  }
}

async function abortRebase(projectPath: string): Promise<void> {
  try {
    await execAsync('git rebase --abort', {
      cwd: projectPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isNonFastForwardError(error: unknown): boolean {
  const text = formatExecError(error).toLowerCase();
  return text.includes('non-fast-forward') || text.includes('fetch first') || text.includes('rejected');
}

function isTimeoutError(error: unknown): boolean {
  const maybeError = error as { killed?: boolean; signal?: string; code?: string | number; message?: string };
  const message = maybeError.message?.toLowerCase() ?? '';
  return maybeError.killed === true || maybeError.signal === 'SIGTERM' || maybeError.code === 'ETIMEDOUT' || message.includes('timed out') || message.includes('timeout');
}

function getErrorCode(error: unknown): string | number | undefined {
  return (error as { code?: string | number }).code;
}

function formatExecError(error: unknown): string {
  if (error instanceof Error) {
    const execError = error as Error & { stdout?: string; stderr?: string };
    return [execError.message, execError.stderr, execError.stdout]
      .filter((part): part is string => Boolean(part?.trim()))
      .join('\n')
      .trim();
  }
  return String(error);
}
