/**
 * pan specialists queue <name>
 *
 * Show pending work in a specialist's queue
 */

import chalk from 'chalk';
import {
  checkSpecialistQueue,
  type SpecialistType,
  getSpecialistMetadata,
} from '../../../lib/cloister/specialists.js';

interface QueueOptions {
  json?: boolean;
}

export function queueCommand(name: string, options: QueueOptions): void {
  // Validate specialist name
  const validNames: SpecialistType[] = ['merge-agent', 'review-agent', 'test-agent'];
  if (!validNames.includes(name as SpecialistType)) {
    console.log(chalk.red(`\nError: Unknown specialist '${name}'`));
    console.log(`Valid specialists: ${validNames.join(', ')}\n`);
    process.exit(1);
  }

  const specialistName = name as SpecialistType;
  const metadata = getSpecialistMetadata(specialistName);

  if (!metadata) {
    console.log(chalk.red(`\nError: Specialist '${specialistName}' not found in registry\n`));
    process.exit(1);
  }

  const queueStatus = checkSpecialistQueue(specialistName);

  if (options.json) {
    console.log(JSON.stringify(queueStatus, null, 2));
    return;
  }

  console.log(chalk.bold(`\n${metadata.displayName} Queue:\n`));

  if (!queueStatus.hasWork) {
    console.log(chalk.dim('Queue is empty - no pending work'));
    console.log('');
    return;
  }

  // Summary
  console.log(`Total items: ${chalk.bold(queueStatus.items.length.toString())}`);
  if (queueStatus.urgentCount > 0) {
    console.log(`Urgent items: ${chalk.red.bold(queueStatus.urgentCount.toString())}`);
  }
  console.log('');

  // List items
  for (let i = 0; i < queueStatus.items.length; i++) {
    const item = queueStatus.items[i];
    const position = i + 1;
    const priorityColor = getPriorityColor(item.priority);

    console.log(`${position}. ${priorityColor(item.priority.toUpperCase())}`);
    console.log(`   ID: ${chalk.dim(item.id)}`);
    console.log(`   Source: ${chalk.dim(item.source)}`);

    if (item.payload) {
      const payload = item.payload as any;

      if (payload.issueId) {
        console.log(`   Issue: ${chalk.cyan(payload.issueId)}`);
      }

      if (payload.prUrl) {
        console.log(`   PR: ${chalk.dim(payload.prUrl)}`);
      }

      if (payload.workspace) {
        console.log(`   Workspace: ${chalk.dim(payload.workspace)}`);
      }

      if (payload.branch) {
        console.log(`   Branch: ${chalk.dim(payload.branch)}`);
      }

      if (payload.filesChanged && Array.isArray(payload.filesChanged)) {
        const fileCount = payload.filesChanged.length;
        console.log(`   Files: ${chalk.dim(fileCount + ' changed')}`);
      }
    }

    const createdAt = new Date(item.createdAt);
    const age = getAge(createdAt);
    console.log(`   Age: ${chalk.dim(age)}`);

    console.log('');
  }
}

function getPriorityColor(priority: string): (text: string) => string {
  switch (priority.toLowerCase()) {
    case 'urgent':
      return chalk.red.bold;
    case 'high':
      return chalk.yellow;
    case 'normal':
      return chalk.white;
    case 'low':
      return chalk.dim;
    default:
      return chalk.white;
  }
}

function getAge(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
