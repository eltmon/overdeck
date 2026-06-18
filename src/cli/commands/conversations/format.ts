/**
 * Shared formatting utilities for conversation CLI commands (PAN-457)
 */

import chalk from 'chalk';
import type { DiscoveredSession } from '../../../lib/database/discovered-sessions-db.js';

/**
 * Render sessions as a table.
 */
export function formatTable(sessions: DiscoveredSession[]): void {
  const cols = [
    { label: 'ID', width: 6 },
    { label: 'Workspace', width: 35 },
    { label: 'Model', width: 22 },
    { label: 'Msgs', width: 5 },
    { label: 'Cost', width: 8 },
    { label: 'Last Active', width: 20 },
    { label: 'Tags', width: 0 },
  ];

  const header = cols.map((c) => c.label.padEnd(c.width)).join(' ');
  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(Math.max(header.length, 80))));

  for (const s of sessions) {
    const workspace = truncate(s.workspacePath ?? s.jsonlPath, 35);
    const model = truncate(s.primaryModel ?? '—', 22);
    const msgs = String(s.messageCount).padEnd(5);
    const cost = s.estimatedCost > 0 ? `$${s.estimatedCost.toFixed(4)}` : '—';
    const lastTs = s.lastTs ? formatDate(s.lastTs) : '—';
    const tags = s.tags.length > 0 ? s.tags.slice(0, 4).join(', ') : '';

    const managed = s.panopticonManaged ? chalk.cyan('●') : ' ';
    const enriched = s.enrichmentLevel > 0 ? chalk.green('✓') : chalk.dim('·');

    console.log(
      `${managed}${enriched} ${String(s.id).padEnd(4)} ${workspace.padEnd(35)} ${model.padEnd(22)} ${msgs} ${cost.padEnd(8)} ${lastTs.padEnd(20)} ${chalk.dim(tags)}`,
    );
  }
}

/**
 * Compact one-line-per-session format.
 */
export function formatBrief(sessions: DiscoveredSession[]): void {
  for (const s of sessions) {
    const workspace = s.workspacePath ?? s.jsonlPath;
    const ts = s.lastTs ? formatDate(s.lastTs) : 'unknown';
    const summary = s.summary ? chalk.dim(` — ${truncate(s.summary, 60)}`) : '';
    console.log(`${chalk.bold(String(s.id).padStart(5))}  ${workspace}  ${chalk.dim(ts)}${summary}`);
  }
}

/**
 * Print only session IDs, one per line.
 */
export function formatIds(sessions: DiscoveredSession[]): void {
  for (const s of sessions) {
    console.log(String(s.id));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return '…' + str.slice(str.length - (max - 1));
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').slice(0, 16);
  } catch {
    return iso;
  }
}
