/**
 * `pan conversations resume <name>` (PAN-5091).
 *
 * Resumes a stopped conversation through the dashboard's
 * `POST /api/conversations/:name/resume` route (scope `operate`), the same
 * door as the dashboard's Resume button. A conversation whose harness still
 * runs is reattached, not started twice. `@<machine>/<name>` resumes one on a
 * linked machine.
 *
 * Exit codes: 0 resumed or already running; 1 refused or failed; 2 not found.
 */
import chalk from 'chalk';

import { exitCli } from '../../exit.js';
import { callDashboard, errorText, isDashboardUnreachable } from '../dashboard-call.js';

export interface ResumeCliDeps {
  call: typeof callDashboard;
  log: (line: string) => void;
  error: (line: string) => void;
}

const defaultDeps: ResumeCliDeps = {
  call: callDashboard,
  log: (line) => console.log(line),
  error: (line) => console.error(chalk.red(line)),
};

/** Resume one conversation; resolves with the exit code. */
export async function resumeConversation(
  name: string,
  opts: { json?: boolean },
  overrides: Partial<ResumeCliDeps> = {},
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  let response: Response;
  try {
    // `@<machine>/<name>` encodes to one segment; the linked-conversation proxy splits it.
    response = await deps.call(`/api/conversations/${encodeURIComponent(name)}/resume`, { method: 'POST', body: {} });
  } catch (error) {
    if (!isDashboardUnreachable(error)) throw error;
    deps.error(`Error: the dashboard is not running (${(error as Error).message}). Start it with pan up.`);
    return 1;
  }
  if (!response.ok) {
    deps.error(`Error: ${await errorText(response)}`);
    return response.status === 404 ? 2 : 1;
  }
  const body = (await response.json().catch(() => ({}))) as { name?: string; reattached?: boolean; redirectedFrom?: string };
  if (opts.json) {
    deps.log(JSON.stringify(body));
    return 0;
  }
  const resumed = body.name ?? name;
  const via = body.redirectedFrom ? ` (continuing ${body.redirectedFrom})` : '';
  deps.log(body.reattached ? `${resumed} is already running${via}; nothing to resume.` : `Resumed ${resumed}${via}.`);
  return 0;
}

export async function resumeAction(name: string, opts: { json?: boolean }): Promise<void> {
  const code = await resumeConversation(name, opts);
  if (code !== 0) await exitCli(code);
}
