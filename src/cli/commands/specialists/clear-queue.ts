/**
 * pan specialists clear-queue <name>
 *
 * Clear all items from a specialist's queue
 * Optionally reset review statuses to pending
 */

import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';
import {
  checkSpecialistQueue,
  type SpecialistType,
  getSpecialistMetadata,
} from '../../../lib/cloister/specialists.js';
import { PANOPTICON_HOME } from '../../../lib/paths.js';

interface ClearQueueOptions {
  force?: boolean;
  resetStatus?: boolean;
}

const ALL_SPECIALISTS: SpecialistType[] = ['merge-agent', 'review-agent', 'test-agent'];
const REVIEW_STATUS_FILE = join(PANOPTICON_HOME, 'review-status.json');

export async function clearQueueCommand(name: string, options: ClearQueueOptions): Promise<void> {
  // Validate specialist name
  if (!ALL_SPECIALISTS.includes(name as SpecialistType)) {
    console.log(chalk.red(`\nError: Unknown specialist '${name}'`));
    console.log(`Valid specialists: ${ALL_SPECIALISTS.join(', ')}\n`);
    process.exit(1);
  }

  const specialistName = name as SpecialistType;
  const metadata = getSpecialistMetadata(specialistName);

  if (!metadata) {
    console.log(chalk.red(`\nError: Specialist '${specialistName}' not found in registry\n`));
    process.exit(1);
  }

  const queueStatus = checkSpecialistQueue(specialistName);

  console.log(chalk.bold(`\n${metadata.displayName} Queue:\n`));

  if (!queueStatus.hasWork) {
    console.log(chalk.dim('Queue is already empty - nothing to clear'));
    console.log('');
    return;
  }

  // Show items that will be cleared
  console.log(`Items to clear: ${chalk.bold(queueStatus.items.length.toString())}`);
  for (const item of queueStatus.items) {
    const payload = item.payload as any;
    if (payload?.issueId) {
      console.log(`  - ${chalk.cyan(payload.issueId)}`);
    } else {
      console.log(`  - ${chalk.dim(item.id)}`);
    }
  }
  console.log('');

  // Confirm if not forced
  if (!options.force) {
    const confirmed = await confirm('Clear all items from queue?');
    if (!confirmed) {
      console.log(chalk.dim('Clear cancelled\n'));
      return;
    }
  }

  // Get issue IDs for status reset
  const issueIds: string[] = [];
  for (const item of queueStatus.items) {
    const payload = item.payload as any;
    if (payload?.issueId) {
      issueIds.push(payload.issueId);
    }
  }

  // Clear the queue by writing empty items array
  const hookFile = join(PANOPTICON_HOME, 'agents', specialistName, 'hook.json');
  if (existsSync(hookFile)) {
    try {
      const hook = JSON.parse(readFileSync(hookFile, 'utf-8'));
      hook.items = [];
      hook.lastChecked = new Date().toISOString();
      writeFileSync(hookFile, JSON.stringify(hook, null, 2), 'utf-8');
      console.log(chalk.green(`✓ Cleared ${queueStatus.items.length} items from queue`));
    } catch (error: any) {
      console.log(chalk.red(`✗ Failed to clear queue: ${error.message}`));
      process.exit(1);
    }
  }

  // Reset review statuses if requested
  if (options.resetStatus && issueIds.length > 0) {
    if (existsSync(REVIEW_STATUS_FILE)) {
      try {
        const statuses = JSON.parse(readFileSync(REVIEW_STATUS_FILE, 'utf-8'));
        let resetCount = 0;

        for (const issueId of issueIds) {
          // Check both case variants
          const key = Object.keys(statuses).find(k => k.toLowerCase() === issueId.toLowerCase());
          if (key && statuses[key]) {
            const status = statuses[key];
            // Only reset if currently reviewing
            if (status.reviewStatus === 'reviewing') {
              status.reviewStatus = 'pending';
              status.updatedAt = new Date().toISOString();
              resetCount++;
            }
          }
        }

        if (resetCount > 0) {
          writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(statuses, null, 2), 'utf-8');
          console.log(chalk.green(`✓ Reset ${resetCount} issue(s) to pending status`));
        }
      } catch (error: any) {
        console.log(chalk.yellow(`⚠ Could not reset statuses: ${error.message}`));
      }
    }
  }

  console.log(chalk.green(`\n✓ Queue cleared for ${metadata.displayName}`));
  console.log(chalk.dim('Review/Merge buttons should now be re-enabled in dashboard\n'));
}

/**
 * Prompt user for confirmation
 */
function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.yellow(`${question} [y/N] `), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
