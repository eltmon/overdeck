/**
 * pan admin cloister freeze / unfreeze
 *
 * Toggle the global Deacon pause flag (`deacon.globally_paused` in app_settings).
 * Distinct from `start`/`stop` (which control whether the watchdog process runs):
 * when frozen, the patrol timer still fires but every cycle short-circuits — no
 * resumes, no dispatches, no recovery. The flag persists across restarts and is
 * read fresh each patrol, so toggling it takes effect on the next tick.
 */

import chalk from 'chalk';
import { setDeaconGloballyPaused, isDeaconGloballyPaused } from '../../../lib/database/app-settings.js';

export async function freezeCommand(): Promise<void> {
  if (isDeaconGloballyPaused()) {
    console.log(chalk.yellow('⏸  Deacon is already frozen (globally paused)'));
    return;
  }
  setDeaconGloballyPaused(true);
  console.log(chalk.green('✓ Deacon frozen — patrols will skip all actions until unfrozen'));
  console.log(chalk.dim('  Running agents are unaffected. Resume with: pan admin cloister unfreeze'));
}

export async function unfreezeCommand(): Promise<void> {
  if (!isDeaconGloballyPaused()) {
    console.log(chalk.yellow('▶  Deacon is already running (not frozen)'));
    return;
  }
  setDeaconGloballyPaused(false);
  console.log(chalk.green('✓ Deacon unfrozen — patrols resume on the next cycle'));
  console.log(chalk.dim('  Auto-resume and review/test/ship dispatch are bounded by the concurrency governor.'));
}
