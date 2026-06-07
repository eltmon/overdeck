/**
 * pan admin cloister brake
 *
 * Emergency brake: forcibly trim running work agents down to the configured
 * concurrency cap. Unlike `emergency-stop` (kills ALL agents), the brake stops
 * only work agents above `max_work_agents`, idle ones first, and leaves them
 * resumable so the deacon re-admits them as slots free.
 */

import chalk from 'chalk';
import { emergencyBrake, getConcurrencyLimits } from '../../../lib/cloister/concurrency.js';

interface BrakeOptions {
  json?: boolean;
}

export async function brakeCommand(options: BrakeOptions): Promise<void> {
  const result = emergencyBrake();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { maxWorkAgents, reservedAdvancingSlots } = getConcurrencyLimits();
  if (result.stopped.length === 0) {
    console.log(chalk.green(`✓ Already within the work-agent cap (${result.before}/${result.cap}) — nothing to trim`));
    return;
  }

  console.log(chalk.yellow.bold(`🛑 Emergency brake — trimming ${result.before} → ${result.cap} work agents`));
  console.log(chalk.dim(`   cap: ${maxWorkAgents} work + ${reservedAdvancingSlots} reserved for review/test/ship`));
  console.log('');
  console.log(chalk.green(`✓ Stopped ${result.stopped.length} work agent(s) (idle-first, resumable):`));
  for (const agentId of result.stopped) {
    console.log(chalk.dim(`  - ${agentId}`));
  }
  console.log('');
  console.log(chalk.dim(`   ${result.remaining} work agent(s) still running. Stopped agents re-admit as slots free.`));
}
