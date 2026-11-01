/**
 * Shared dashboard-call helpers for the `pan machines` verbs (PAN-4645 WI-14;
 * split out of `machines.ts` in PAN-4404 so `machines-ssh.ts` can use them
 * without an import cycle).
 */
import chalk from 'chalk';

import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';

export const NOT_RUNNING = 'Overdeck dashboard is not running. Start the dashboard with pan up, then retry.';
export const NEEDS_PAN_UP = 'The dashboard rejected this machine\'s internal token. Start the dashboard with pan up (a `pan serve` server does not share it).';

/** Print `message` in red and exit 1. */
export async function fail(message: string): Promise<never> {
  console.error(chalk.red(message));
  const { exitCli } = await import('../exit.js');
  return exitCli(1);
}

/** Call the dashboard; exit 1 with a readable message when it is down, rejects the token, or answers an error. */
export async function call(verb: string, path: string, init: { method: string; body?: unknown }): Promise<Response | never> {
  let response: Response;
  try {
    response = await callDashboard(path, init);
  } catch (error) {
    if (isDashboardUnreachable(error)) return fail(NOT_RUNNING);
    throw error;
  }
  if (response.status === 401) return fail(NEEDS_PAN_UP);
  if (!response.ok) return fail(`pan machines ${verb} failed: ${await errorText(response)}`);
  return response;
}
