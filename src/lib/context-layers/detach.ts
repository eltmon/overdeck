/**
 * Explicit migration for removing historical Overdeck/Panopticon managed
 * regions from native harness files. This module is deliberately not imported
 * by install, sync, startup, workspace creation, or agent launch paths.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { backupFileSync, createBackupTimestamp } from '../backup.js';
import { getOverdeckHome } from '../paths.js';
import { listProjectsSync } from '../projects.js';

const BEGIN_MARKERS = [
  '<!-- BEGIN OVERDECK CONTEXT',
  '<!-- BEGIN PANOPTICON CONTEXT',
] as const;
const END_MARKERS = [
  '<!-- END OVERDECK CONTEXT -->',
  '<!-- END PANOPTICON CONTEXT -->',
] as const;

export interface ContextDetachItem {
  file: string;
  status: 'removable' | 'removed' | 'ambiguous' | 'manual-only';
  reason?: string;
  managedBlock?: string;
  backupPath?: string;
}

function occurrences(content: string, needle: string): number[] {
  const indexes: number[] = [];
  let offset = 0;
  while (offset < content.length) {
    const index = content.indexOf(needle, offset);
    if (index < 0) break;
    indexes.push(index);
    offset = index + needle.length;
  }
  return indexes;
}

/** Plan removal of exactly one recognized managed region without normalizing surrounding bytes. */
export function planManagedRegionDetach(file: string, content: string): ContextDetachItem | null {
  const matches = BEGIN_MARKERS.flatMap((begin, markerIndex) =>
    occurrences(content, begin).map((start) => ({ start, markerIndex })),
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    return { file, status: 'ambiguous', reason: `found ${matches.length} managed-region starts` };
  }

  const { start, markerIndex } = matches[0]!;
  const openingEnd = content.indexOf('-->', start);
  if (openingEnd < 0) return { file, status: 'ambiguous', reason: 'managed-region opening marker is malformed' };
  const endMarker = END_MARKERS[markerIndex]!;
  const ends = occurrences(content, endMarker).filter((index) => index > openingEnd);
  if (ends.length !== 1) {
    return { file, status: 'ambiguous', reason: `found ${ends.length} matching managed-region ends` };
  }

  let end = ends[0]! + endMarker.length;
  if (content.startsWith('\r\n', end)) end += 2;
  else if (content[end] === '\n') end += 1;
  return { file, status: 'removable', managedBlock: content.slice(start, end) };
}

function nativeTargets(): string[] {
  const targets = new Set<string>([
    join(homedir(), '.claude', 'CLAUDE.md'),
    join(homedir(), '.codex', 'AGENTS.md'),
    join(homedir(), '.codex', 'AGENTS.override.md'),
  ]);
  for (const { config } of listProjectsSync()) {
    targets.add(join(config.path, 'CLAUDE.md'));
    targets.add(join(config.path, 'AGENTS.md'));
    targets.add(join(config.path, 'AGENTS.override.md'));
    targets.add(join(config.path, '.claude', 'CLAUDE.md'));
  }
  return [...targets].sort();
}

function historicalCodexHomes(): string[] {
  const agentsRoot = join(getOverdeckHome(), 'agents');
  if (!existsSync(agentsRoot)) return [];
  return readdirSync(agentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(agentsRoot, entry.name, 'codex-home', 'AGENTS.md'))
    .filter(existsSync)
    .sort();
}

/**
 * Preview or explicitly apply native-file cleanup. Existing Codex-home copies
 * have no trustworthy region marker, so they are reported for manual cleanup
 * and never changed automatically.
 */
export function detachManagedContextSync(apply: boolean): ContextDetachItem[] {
  const results: ContextDetachItem[] = [];
  const timestamp = apply ? createBackupTimestamp() : '';
  for (const file of nativeTargets()) {
    if (!existsSync(file)) continue;
    if (lstatSync(file).isSymbolicLink()) {
      results.push({ file, status: 'ambiguous', reason: 'refusing to modify a symlink' });
      continue;
    }
    const existing = readFileSync(file, 'utf-8');
    const plan = planManagedRegionDetach(file, existing);
    if (!plan) continue;
    if (!apply || plan.status !== 'removable' || !plan.managedBlock) {
      results.push(plan);
      continue;
    }
    const backupPath = backupFileSync(file, timestamp);
    if (!backupPath) {
      results.push({ ...plan, status: 'ambiguous', reason: 'backup could not be created' });
      continue;
    }
    const start = existing.indexOf(plan.managedBlock);
    if (start < 0) {
      results.push({ ...plan, status: 'ambiguous', reason: 'file changed after preview' });
      continue;
    }
    const next = existing.slice(0, start) + existing.slice(start + plan.managedBlock.length);
    writeFileSync(file, next, 'utf-8');
    results.push({ ...plan, status: 'removed', backupPath });
  }

  for (const file of historicalCodexHomes()) {
    if (readFileSync(file, 'utf8').trim().length === 0) continue;
    results.push({
      file,
      status: 'manual-only',
      reason: 'historical unmarked Codex-home copy; not safe to identify or remove automatically',
    });
  }
  return results;
}
