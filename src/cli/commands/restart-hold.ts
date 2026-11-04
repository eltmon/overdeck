/**
 * `pan restart hold` / `pan restart release` (PAN-5007) and the refusal check
 * that `pan reload`, `pan restart` and `pan restart approve` run first.
 *
 * The hold itself lives in `src/lib/restart-hold.ts`.
 */

import chalk from 'chalk';
import {
  describeRestartHold,
  parseRestartHoldUntil,
  readRestartHold,
  releaseRestartHold,
  restartHoldActor,
  restartHoldRefusal,
  writeRestartHold,
  type RestartHold,
} from '../../lib/restart-hold.js';

export interface RestartHoldOptions {
  reason?: string;
  until?: string;
  status?: boolean;
}

/**
 * Print the refusal and set exit code 1 when a hold is active. Returns true
 * when the caller must stop.
 */
export async function refuseIfRestartHeld(action: string): Promise<boolean> {
  const hold = await readRestartHold();
  if (!hold) return false;
  console.error(chalk.red(restartHoldRefusal(action, hold)));
  process.exitCode = 1;
  return true;
}

function printStatus(hold: RestartHold | null): void {
  if (!hold) {
    console.log('No restart hold is active. `pan reload` and `pan restart` run normally.');
    return;
  }
  console.log(chalk.yellow(`Restart hold active: ${describeRestartHold(hold)}.`));
  console.log('  `pan reload`, `pan restart` and restart approvals refuse until `pan restart release`.');
}

export async function restartHoldCommand(options: RestartHoldOptions): Promise<void> {
  if (options.status) {
    printStatus(await readRestartHold());
    return;
  }

  const reason = options.reason?.trim();
  if (!reason) {
    console.error(chalk.red('Error: `pan restart hold` needs --reason "<why>" (or --status to show the current hold).'));
    process.exitCode = 2;
    return;
  }

  let until: string | undefined;
  if (options.until !== undefined) {
    try {
      until = parseRestartHoldUntil(options.until);
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exitCode = 2;
      return;
    }
  }

  const previous = await readRestartHold();
  const hold: RestartHold = {
    reason,
    who: restartHoldActor(),
    setAt: new Date().toISOString(),
    ...(until ? { until } : {}),
  };
  await writeRestartHold(hold);
  if (previous) {
    console.log(chalk.dim(`  Replaced the previous hold: ${describeRestartHold(previous)}.`));
  }
  console.log(chalk.green(`✓ Restart hold set: ${describeRestartHold(hold)}.`));
  console.log('  `pan reload`, `pan restart` and restart approvals now refuse. Release with `pan restart release`.');
}

export async function restartReleaseCommand(): Promise<void> {
  const released = await releaseRestartHold();
  if (!released) {
    console.log('No restart hold was set, so nothing changed.');
    return;
  }
  console.log(chalk.green(`✓ Released the restart hold: ${describeRestartHold(released)}.`));
  console.log('  A reload refused during the hold was not queued. Run `pan reload` to ship anything that merged meanwhile.');
}
