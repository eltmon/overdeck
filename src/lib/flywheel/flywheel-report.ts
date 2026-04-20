/**
 * FLYWHEEL-REPORT.md writer (PAN-709, bead dai)
 *
 * Append-only. One section per flywheel run or daemon cycle.
 * Creates the file on first run. Never rewrites existing sections.
 * No cost fields, no spend charts — per the PRD cost-out decision.
 */

import { promises as fsPromises } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_REPORT_PATH = join(homedir(), 'docs', 'FLYWHEEL-REPORT.md');

const REPORT_HEADER = `# Flywheel Report

_Living record of how Panopticon teaches itself. Each section documents one flywheel revolution._

`;

export interface FlywheelRunStats {
  runNumber: number;
  timestamp: string; // ISO date string
  /** 'daemon-event', 'daemon-scheduled', or '/all-up' */
  trigger: string;
  issuesMergedThisRun: string[];
  skillChangesFiled: Array<{ issueId?: string; title: string; signals: number }>;
  substrateInlineFixes: Array<{ commit: string; description: string }>;
  topFrictionPatterns: Array<{ pattern: string; issueCount: number; note?: string }>;
  watchlist: Array<{ description: string; signals: number }>;
  wins?: string[];
  retroStats: {
    total: number;
    surprise: number;
    noop: number;
  };
}

/**
 * Format a flywheel run section for appending to FLYWHEEL-REPORT.md.
 */
export function formatRunSection(stats: FlywheelRunStats): string {
  const date = stats.timestamp.split('T')[0];
  const lines: string[] = [];

  lines.push(`## Run ${stats.runNumber} — ${date} — _${stats.trigger}_`);
  lines.push('');

  // Quick stats
  lines.push('### Quick stats');
  if (stats.issuesMergedThisRun.length > 0) {
    lines.push(`- Issues merged this run: ${stats.issuesMergedThisRun.length} (${stats.issuesMergedThisRun.join(', ')})`);
  }
  lines.push(`- Retros processed: ${stats.retroStats.total} (${stats.retroStats.surprise} surprise, ${stats.retroStats.noop} no-op)`);
  lines.push(`- Skill-change issues filed: ${stats.skillChangesFiled.length}`);
  lines.push(`- Substrate bugs fixed inline: ${stats.substrateInlineFixes.length}`);
  lines.push('');

  // Skill-change issues filed
  if (stats.skillChangesFiled.length > 0) {
    lines.push('### Skill-change issues filed');
    for (const issue of stats.skillChangesFiled) {
      const idPart = issue.issueId ? `[${issue.issueId}](…) — ` : '';
      lines.push(`- ${idPart}${issue.title} (signals: ${issue.signals})`);
    }
    lines.push('');
  }

  // Substrate bugs fixed inline
  if (stats.substrateInlineFixes.length > 0) {
    lines.push('### Substrate bugs fixed inline (blocker tier)');
    for (const fix of stats.substrateInlineFixes) {
      lines.push(`- Commit \`${fix.commit}\` — ${fix.description}`);
    }
    lines.push('');
  }

  // Top friction patterns
  if (stats.topFrictionPatterns.length > 0) {
    lines.push('### Top friction patterns this run');
    for (let i = 0; i < stats.topFrictionPatterns.length; i++) {
      const p = stats.topFrictionPatterns[i];
      const notePart = p.note ? ` ${p.note}` : '';
      lines.push(`${i + 1}. **${p.pattern}** — ${p.issueCount} issue${p.issueCount === 1 ? '' : 's'} affected.${notePart}`);
    }
    lines.push('');
  }

  // Watchlist
  if (stats.watchlist.length > 0) {
    lines.push('### Watchlist (below 3-signal threshold)');
    for (const entry of stats.watchlist) {
      lines.push(`- ${entry.description} — ${entry.signals} signal${entry.signals === 1 ? '' : 's'}`);
    }
    lines.push('');
  }

  // Wins
  if (stats.wins && stats.wins.length > 0) {
    lines.push('### Wins');
    for (const win of stats.wins) {
      lines.push(`- ${win}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

/**
 * Append a new flywheel run section to docs/FLYWHEEL-REPORT.md.
 * Creates the file with a header if it doesn't exist yet.
 * Never rewrites existing content — append-only.
 *
 * @param stats - The stats for this run
 * @param reportPath - Override the report path (for testing)
 * @returns The path written to
 */
export async function appendFlywheelReport(
  stats: FlywheelRunStats,
  reportPath: string = DEFAULT_REPORT_PATH,
): Promise<string> {
  let existing = '';
  try {
    existing = await fsPromises.readFile(reportPath, 'utf-8');
  } catch {
    // File doesn't exist yet — start fresh with the header
    existing = REPORT_HEADER;
  }

  const newSection = formatRunSection(stats);
  // Insert after the header (after the intro paragraph), before any existing run sections
  // "Append-only" means prepend new runs so newest is first (matches the PRD schema example)
  const firstRunIdx = existing.indexOf('\n## Run ');
  let updated: string;
  if (firstRunIdx === -1) {
    // No existing runs — just append
    updated = existing + newSection;
  } else {
    // Insert before the first existing run section
    updated = existing.slice(0, firstRunIdx + 1) + newSection + existing.slice(firstRunIdx + 1);
  }

  await fsPromises.mkdir(dirname(reportPath), { recursive: true });
  await fsPromises.writeFile(reportPath, updated, 'utf-8');
  return reportPath;
}
