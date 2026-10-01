/**
 * `pan review waive-test-removal <id> --reason "…"` (PAN-4438)
 *
 * Operator-only. Grants a test-skip gate waiver pinned to the workspace's
 * current head anchor through `grantTestSkipWaiver` — the same function the
 * dashboard Test/Lint panel's waiver control calls.
 */
import chalk from 'chalk';
import { formatAnchorShort } from '../../lib/git-utils.js';
import { grantTestSkipWaiver } from '../../lib/cloister/test-skip-waiver.js';
import { verdictCallerFromEnv, type VerdictCaller } from '../../lib/cloister/verdict-caller.js';

export interface WaiveTestRemovalDeps {
  caller: () => VerdictCaller;
  grant: typeof grantTestSkipWaiver;
}

const defaultDeps: WaiveTestRemovalDeps = {
  caller: verdictCallerFromEnv,
  grant: grantTestSkipWaiver,
};

/** Commander-facing entry point: Commander appends its `Command` instance as a
 * trailing argument, so this takes exactly two params and forwards to the
 * injectable implementation below with the real deps. */
export async function waiveTestRemovalCommand(id: string, options: { reason?: string }): Promise<void> {
  return runWaiveTestRemoval(id, options, defaultDeps);
}

export async function runWaiveTestRemoval(
  id: string,
  options: { reason?: string },
  deps: WaiveTestRemovalDeps,
): Promise<void> {
  const issueId = id.toUpperCase();
  const caller = deps.caller();

  if (caller.kind === 'agent') {
    console.error(chalk.red(
      `Waiving a test removal is operator-only. ${caller.id} is an agent session; a pipeline agent may not waive the coverage loss it produced.`,
    ));
    process.exitCode = 1;
    return;
  }

  const result = await deps.grant({ issueId, reason: options.reason ?? '', by: caller.id ?? 'operator' });

  if (!result.ok) {
    console.error(chalk.red(result.message));
    process.exitCode = 1;
    return;
  }

  const { waiver, workspacePath } = result;
  console.log(`Waived test removal for ${issueId} at ${formatAnchorShort(waiver.sha)}.`);
  console.log(`Pinned head: ${waiver.sha}`);
  console.log(`Reason: ${waiver.reason}`);
  console.log(`Stored at: ${workspacePath}/.overdeck/test-removal-waiver.json`);
  console.log('The waiver expires when the branch head moves. It never waives an added .skip/.only.');
  console.log(`Run pan review request ${issueId} to re-run verification.`);
}
