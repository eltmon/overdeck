/**
 * pan specialists list
 *
 * Show all specialists with their status
 */

import chalk from 'chalk';
import { getAllSpecialistStatus, type SpecialistStatus } from '../../../lib/cloister/specialists.js';

interface ListOptions {
  json?: boolean;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const specialists = await getAllSpecialistStatus();

  if (options.json) {
    console.log(JSON.stringify(specialists, null, 2));
    return;
  }

  console.log(chalk.bold('\nSpecialist Agents:\n'));

  if (specialists.length === 0) {
    console.log(chalk.dim('No specialists configured.'));
    console.log('');
    return;
  }

  for (const specialist of specialists) {
    displaySpecialist(specialist);
  }

  console.log('');
}

function displaySpecialist(specialist: SpecialistStatus): void {
  const statusIcon = getStatusIcon(specialist);
  const statusColor = getStatusColor(specialist);
  const enabledBadge = specialist.enabled ? chalk.green('enabled') : chalk.dim('disabled');

  console.log(`${statusIcon} ${chalk.bold(specialist.displayName)} (${enabledBadge})`);
  console.log(`  ${chalk.dim(specialist.description)}`);
  console.log(`  Status: ${statusColor(specialist.state)}`);

  if (specialist.isRunning) {
    console.log(`  Running: ${chalk.cyan(specialist.tmuxSession)}`);
    if (specialist.currentIssue) {
      console.log(`  Working on: ${chalk.cyan(specialist.currentIssue)}`);
    }
  }

  if (specialist.sessionId) {
    const shortId = specialist.sessionId.substring(0, 8);
    console.log(`  Session: ${chalk.dim(shortId + '...')}`);
  }

  if (specialist.contextTokens) {
    const tokensFormatted = specialist.contextTokens.toLocaleString();
    console.log(`  Context: ${chalk.dim(tokensFormatted + ' tokens')}`);
  }

  if (specialist.lastWake) {
    const lastWake = new Date(specialist.lastWake);
    const relative = getRelativeTime(lastWake);
    console.log(`  Last wake: ${chalk.dim(relative)}`);
  }

  console.log('');
}

function getStatusIcon(specialist: SpecialistStatus): string {
  if (!specialist.enabled) return chalk.dim('○');
  if (specialist.isRunning) return chalk.green('●');
  if (specialist.state === 'sleeping') return chalk.yellow('●');
  return chalk.dim('○');
}

function getStatusColor(specialist: SpecialistStatus): (text: string) => string {
  if (specialist.isRunning) return chalk.green;
  if (specialist.state === 'sleeping') return chalk.yellow;
  return chalk.dim;
}

function getRelativeTime(date: Date): string {
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
