/**
 * Explicit migration for removing historical Overdeck/Panopticon managed
 * regions from native harness files. This module is deliberately not imported
 * by install, sync, startup, workspace creation, or agent launch paths.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
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
  const targets = new Set<string>([join(homedir(), '.claude', 'CLAUDE.md')]);
  for (const { config } of listProjectsSync()) {
    targets.add(join(config.path, 'CLAUDE.md'));
    targets.add(join(config.path, 'AGENTS.md'));
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

function sha256(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function manifestOwnedNativeItems(apply: boolean, timestamp: string): ContextDetachItem[] {
  const results: ContextDetachItem[] = [];
  for (const root of [join(homedir(), '.claude'), join(homedir(), '.agents')]) {
    const manifestPath = join(root, '.overdeck-manifest.json');
    if (!existsSync(manifestPath)) continue;
    let installed: Record<string, { hash?: unknown }> = {};
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { managed_by?: unknown; installed?: unknown };
      if (parsed.managed_by !== 'overdeck' || !parsed.installed || typeof parsed.installed !== 'object') continue;
      installed = parsed.installed as Record<string, { hash?: unknown }>;
    } catch {
      results.push({ file: manifestPath, status: 'ambiguous', reason: 'managed manifest is malformed' });
      continue;
    }
    for (const [relative, record] of Object.entries(installed)) {
      const target = resolve(root, relative);
      if (!target.startsWith(`${resolve(root)}/`) || !existsSync(target)) continue;
      if (lstatSync(target).isSymbolicLink()) {
        results.push({ file: target, status: 'manual-only', reason: 'manifest target is now a symlink' });
        continue;
      }
      const expected = typeof record.hash === 'string' ? record.hash : '';
      if (!expected || sha256(target) !== expected) {
        results.push({ file: target, status: 'manual-only', reason: 'manifest-owned path was user-modified; preserved' });
        continue;
      }
      if (!apply) {
        results.push({ file: target, status: 'removable', reason: 'content exactly matches Overdeck ownership manifest' });
        continue;
      }
      const backupPath = backupFileSync(target, timestamp);
      if (!backupPath) {
        results.push({ file: target, status: 'ambiguous', reason: 'backup could not be created' });
        continue;
      }
      unlinkSync(target);
      results.push({ file: target, status: 'removed', reason: 'exact manifest-owned artifact', backupPath });
    }
  }
  return results;
}

function historicalNativeConfigItems(): ContextDetachItem[] {
  const candidates = [
    join(homedir(), '.claude', 'settings.json'),
    join(homedir(), '.claude', 'mcp.json'),
    join(homedir(), '.claude', 'statusline-command.sh'),
  ];
  return candidates.flatMap(file => {
    if (!existsSync(file) || lstatSync(file).isSymbolicLink()) return [];
    const content = readFileSync(file, 'utf8');
    return /\.(?:overdeck|panopticon)\//.test(content)
      ? [{ file, status: 'manual-only' as const, reason: 'contains historical Overdeck registration mixed with user configuration; preserved' }]
      : [];
  });
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
    results.push({
      file,
      status: 'manual-only',
      reason: 'historical unmarked Codex-home copy; not safe to identify or remove automatically',
    });
  }
  results.push(...manifestOwnedNativeItems(apply, timestamp));
  results.push(...historicalNativeConfigItems());
  return results;
}
