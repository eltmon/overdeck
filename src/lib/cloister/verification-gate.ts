/**
 * Verification Gate — runs typecheck, lint, and tests before code review.
 *
 * Runs checks sequentially and bails on the first failure.
 * Supports both local and remote (SSH) workspaces.
 * All execution is async — never blocks the event loop.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per check

export interface CheckResult {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface VerificationResult {
  passed: boolean;
  failedCheck?: string;
  checks: CheckResult[];
  summary: string;
}

export interface VerificationOptions {
  isRemote?: boolean;
  vmName?: string;
}

/**
 * Run a single verification check.
 * Wraps the command with SSH for remote workspaces.
 */
async function runCheck(
  name: string,
  command: string,
  workspacePath: string,
  opts: VerificationOptions,
): Promise<CheckResult> {
  const start = Date.now();

  let fullCommand: string;
  let cwd: string | undefined;

  if (opts.isRemote && opts.vmName) {
    fullCommand = `ssh -A ${opts.vmName}.exe.xyz "cd ${workspacePath} && ${command}"`;
    cwd = undefined;
  } else {
    fullCommand = command;
    cwd = workspacePath;
  }

  try {
    const { stdout, stderr } = await execAsync(fullCommand, {
      cwd,
      encoding: 'utf-8',
      timeout: TIMEOUT_MS,
    });
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return {
      name,
      passed: true,
      output: output || '(no output)',
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();
    return {
      name,
      passed: false,
      output: output || '(no output)',
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Run the verification gate: typecheck → lint → test (bail on first failure).
 *
 * Each step has a 5-minute timeout. Results include per-check output so
 * agents can diagnose failures from the feedback file alone.
 */
export async function runVerificationGate(
  workspacePath: string,
  opts: VerificationOptions = {},
): Promise<VerificationResult> {
  const checks: CheckResult[] = [];

  const steps: Array<{ name: string; command: string }> = [
    { name: 'typecheck', command: 'npm run typecheck 2>&1' },
    { name: 'lint', command: 'npm run lint 2>&1' },
    { name: 'test', command: 'npm test 2>&1' },
  ];

  for (const step of steps) {
    const result = await runCheck(step.name, step.command, workspacePath, opts);
    checks.push(result);

    if (!result.passed) {
      const truncatedOutput = result.output.length > 3000
        ? result.output.slice(0, 3000) + '\n...(truncated)'
        : result.output;
      return {
        passed: false,
        failedCheck: step.name,
        checks,
        summary: `Verification FAILED at ${step.name} (${result.durationMs}ms):\n\n${truncatedOutput}`,
      };
    }
  }

  return {
    passed: true,
    checks,
    summary: `All checks passed: ${checks.map(c => `${c.name} (${c.durationMs}ms)`).join(', ')}`,
  };
}
