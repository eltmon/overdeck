/**
 * `pan machines add-project <machine> <projectKey>` (PAN-4651 FR-4, D-4651-14).
 *
 * Copies a project between linked machines through the project-creation core:
 * clone from the repository's origin on the target, register it, then write
 * the chosen git-ignored files (0600, never overwriting). By default the
 * source machine is `<machine>` and the target is this machine; with
 * `--to <target>` the project is one of this machine's and goes to `<target>`
 * (`pan machines add-project <this label> <key> --to desk`); `.env`,
 * `.envrc` and `.dev.vars` are included unless `--no-env`, and `--file <path>`
 * adds more. The verb waits for the add job and prints each file's result.
 */
import type { Command } from 'commander';

import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';
import { NOT_RUNNING } from './machines-call.js';

export interface AddProjectOptions {
  to?: string;
  file?: string[];
  env?: boolean;
  parentDir?: string;
  json?: boolean;
}

export interface AddProjectCliDeps {
  call: (path: string, init: { method: string; body?: unknown }) => Promise<{ status: number; json: unknown }>;
  sleep: (ms: number) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultDeps = (): AddProjectCliDeps => ({
  call: async (path, init) => {
    const response = await callDashboard(path, init);
    if (!response.ok) return { status: response.status, json: { error: await errorText(response) } };
    return { status: response.status, json: await response.json().catch(() => null) };
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
});

export const ADD_PROJECT_POLL_MS = 1_000;

interface AddJob { step: 'clone' | 'files' | 'done' | 'failed'; error?: string; projectKey?: string; files?: Array<{ path: string; result: string }> }

const errorOf = (json: unknown, status: number): string => {
  const error = (json as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error : `HTTP ${status}`;
};

/** Returns the exit code. */
export async function runMachinesAddProject(machine: string, projectKey: string, options: AddProjectOptions, deps: AddProjectCliDeps = defaultDeps()): Promise<number> {
  const there = Boolean(options.to);
  const body = {
    machine: there ? options.to : machine,
    projectKey,
    files: options.file ?? [],
    includePreselected: options.env !== false,
    ...(!there && options.parentDir ? { parentDir: options.parentDir } : {}),
  };
  let started: { status: number; json: unknown };
  try {
    started = await deps.call(there ? '/api/fleet/projects/add-there' : '/api/fleet/projects/add-here', { method: 'POST', body });
  } catch (error) {
    deps.stderr(isDashboardUnreachable(error) ? NOT_RUNNING : (error as Error).message);
    return 1;
  }
  const jobId = (started.json as { jobId?: unknown } | null)?.jobId;
  if (started.status !== 202 || typeof jobId !== 'string') {
    deps.stderr(`pan machines add-project failed: ${errorOf(started.json, started.status)}`);
    return 1;
  }
  const owner = (started.json as { machine?: unknown } | null)?.machine;
  const jobPath = `/api/fleet/projects/add-jobs/${encodeURIComponent(jobId)}${there && typeof owner === 'string' ? `?machine=${encodeURIComponent(owner)}` : ''}`;
  deps.stderr(there ? `Cloning ${projectKey} on ${options.to}…` : `Cloning ${projectKey} from ${machine}…`);
  for (;;) {
    const answer = await deps.call(jobPath, { method: 'GET' });
    const job = answer.json as AddJob | null;
    if (answer.status !== 200 || !job) {
      deps.stderr(`pan machines add-project lost its job: ${errorOf(answer.json, answer.status)}`);
      return 1;
    }
    if (job.step === 'failed') {
      deps.stderr(`pan machines add-project failed: ${job.error ?? 'unknown error'}`);
      return 1;
    }
    if (job.step === 'done') {
      if (options.json) deps.stdout(JSON.stringify(job));
      else {
        deps.stdout(`Added ${job.projectKey ?? projectKey} to ${there ? options.to : 'this machine'}.`);
        for (const file of job.files ?? []) deps.stdout(`  ${file.path}: ${file.result}`);
      }
      return 0;
    }
    await deps.sleep(ADD_PROJECT_POLL_MS);
  }
}

export function registerMachinesAddProjectCommand(machines: Command): void {
  machines
    .command('add-project <machine> <project-key>')
    .description('Clone a linked machine\'s project here (or, with --to, this machine\'s project there) and copy its .env-style files (0600, never overwriting)')
    .option('--to <machine>', 'Add this machine\'s project <project-key> to <machine> instead')
    .option('--file <path>', 'Also copy this git-ignored file; repeat for more', (path: string, paths: string[] = []) => [...paths, path])
    .option('--no-env', 'Do not copy .env, .envrc and .dev.vars')
    .option('--parent-dir <dir>', 'Clone under this directory (default: the projects folder)')
    .option('--json', 'Print the finished add job as JSON')
    .action(async (machine: string, projectKey: string, options: AddProjectOptions) => {
      const code = await runMachinesAddProject(machine, projectKey, options);
      const { exitCli } = await import('../exit.js');
      await exitCli(code);
    });
}
