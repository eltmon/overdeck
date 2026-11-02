/** `pan conv auto-settle-idle-days [days]` — read or set conversations.auto_settle_idle_days (PAN-4655). */

import chalk from 'chalk';

import { exitCli } from '../../exit.js';
import {
  getConversationsAutoSettleIdleDays,
  parseAutoSettleIdleDays,
  setConversationsAutoSettleIdleDays,
} from '../../../lib/overdeck/control-settings.js';

export async function autoSettleIdleDaysAction(value?: string): Promise<void> {
  if (value === undefined) {
    const days = getConversationsAutoSettleIdleDays();
    console.log(days === 0 ? '0 (off)' : String(days));
    return;
  }
  const days = parseAutoSettleIdleDays(value);
  if (days === null) {
    console.error(chalk.red(`Error: expected a whole number of days from 0 to 365, got "${value}"`));
    return exitCli(1);
  }
  setConversationsAutoSettleIdleDays(days);
  console.log(chalk.green(days === 0
    ? '✓ Idle auto-settle is off'
    : `✓ Conversations idle for ${days} day(s) are settled automatically`));
}
