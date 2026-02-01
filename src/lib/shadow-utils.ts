/**
 * Shadow Mode Utilities
 *
 * Shared utility functions for shadow mode operations.
 * Used by sync.ts, refresh.ts, shadow.ts and other commands.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

/**
 * Get Linear API key from environment or config file
 */
export function getLinearApiKey(): string | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.LINEAR_API_KEY || null;
}

/**
 * Check if an issue ID is a Linear issue (has team prefix like MIN-, PAN-, etc.)
 */
export function isLinearIssue(issueId: string): boolean {
  return /^[A-Z]+-\d+$/i.test(issueId);
}

/**
 * Format state for display with colors
 */
export function formatState(state: string): string {
  const colors: Record<string, (s: string) => string> = {
    'open': chalk.blue,
    'in_progress': chalk.yellow,
    'closed': chalk.green,
  };

  const display = state.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  const colorFn = colors[state] || chalk.white;
  return colorFn(display);
}

/**
 * Format a date string for display with relative time
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let relative = '';
  if (diffMins < 1) {
    relative = 'just now';
  } else if (diffMins < 60) {
    relative = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    relative = `${diffHours}h ago`;
  } else {
    relative = `${diffDays}d ago`;
  }

  return `${date.toLocaleString()} ${chalk.dim(`(${relative})`)}`;
}

/**
 * Map canonical state to Linear state name
 */
export function getLinearStateName(state: string): string {
  switch (state) {
    case 'open':
      return 'Backlog';
    case 'in_progress':
      return 'In Progress';
    case 'closed':
      return 'Done';
    default:
      return 'Backlog';
  }
}
