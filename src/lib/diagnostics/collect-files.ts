/**
 * File collector for `pan diagnose` bundles (PAN-4643 FR-8, FR-9).
 *
 * Reads Overdeck's config, a bounded tail of its logs, and a copy of the
 * `pan-diagnose` troubleshooting skill. Every read is wrapped: a missing or
 * unreadable file records a `CollectorFailure` instead of throwing.
 */

import type { Dirent } from 'fs';
import { lstat, open, readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { SYNC_SOURCES } from '../paths.js';
import type { BundleEntry, CollectorFailure, CollectorOutcome } from './bundle.js';

const CORE_LOG_NAMES = [
  'dashboard.log',
  'supervisor.log',
  'deacon.log',
  'sync.log',
  'hooks.log',
  'smee.log',
  'auto-approve.log',
];
const OTHER_LOG_PATTERN = /\.(log|jsonl)$/;
const OTHER_LOGS_LIMIT = 3;
const TAIL_MAX_BYTES = 64 * 1024;
const TAIL_MAX_LINES = 200;
const ENTRY_MAX_BYTES = 48 * 1024;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampLines(text: string, maxLines: number): string {
  const trailingNewline = text.endsWith('\n');
  const body = trailingNewline ? text.slice(0, -1) : text;
  const lines = body.length === 0 ? [] : body.split('\n');
  const kept = lines.slice(-maxLines);
  return kept.join('\n') + (trailingNewline ? '\n' : '');
}

function clampBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return text;
  const trailingNewline = text.endsWith('\n');
  const body = trailingNewline ? text.slice(0, -1) : text;
  const lines = body.length === 0 ? [''] : body.split('\n');
  while (lines.length > 1 && Buffer.byteLength(lines.join('\n'), 'utf-8') > maxBytes) {
    lines.shift();
  }
  let result = lines.join('\n');
  if (Buffer.byteLength(result, 'utf-8') > maxBytes) {
    // A single line wider than the cap: hard-truncate from the front,
    // keeping the tail (the end of the last line matters most).
    const buf = Buffer.from(result, 'utf-8');
    result = buf.subarray(buf.length - maxBytes).toString('utf-8');
  }
  return result + (trailingNewline ? '\n' : '');
}

/**
 * Read at most the last `TAIL_MAX_BYTES` of `filePath` (never the whole
 * file), drop a leading partial line when the read did not start at offset
 * 0, then clamp to the last `TAIL_MAX_LINES` lines and `ENTRY_MAX_BYTES`.
 */
async function tailLogFile(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const stats = await handle.stat();
    const size = stats.size;
    const start = Math.max(0, size - TAIL_MAX_BYTES);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    if (length > 0) {
      await handle.read(buffer, 0, length, start);
    }
    let text = buffer.toString('utf-8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
    }
    return clampBytes(clampLines(text, TAIL_MAX_LINES), ENTRY_MAX_BYTES);
  } finally {
    await handle.close();
  }
}

interface SelectedLog {
  name: string;
  filePath: string;
}

async function selectLogFiles(logsDir: string): Promise<SelectedLog[]> {
  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(logsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const regularFiles = new Map<string, string>();
  for (const entry of dirEntries) {
    const filePath = join(logsDir, entry.name);
    try {
      const stats = await lstat(filePath);
      if (!stats.isFile()) continue; // excludes symlinks (even to a file) and directories
    } catch {
      continue;
    }
    regularFiles.set(entry.name, filePath);
  }

  const selected: SelectedLog[] = [];
  const chosenNames = new Set<string>();

  for (const coreName of CORE_LOG_NAMES) {
    const filePath = regularFiles.get(coreName);
    if (filePath) {
      selected.push({ name: coreName, filePath });
      chosenNames.add(coreName);
    }
  }

  const otherCandidates: Array<SelectedLog & { mtimeMs: number }> = [];
  for (const [name, filePath] of regularFiles) {
    if (chosenNames.has(name) || !OTHER_LOG_PATTERN.test(name)) continue;
    try {
      const stats = await stat(filePath);
      otherCandidates.push({ name, filePath, mtimeMs: stats.mtimeMs });
    } catch {
      // Unreadable between the lstat above and here; skip rather than fail the bundle.
    }
  }
  otherCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  selected.push(...otherCandidates.slice(0, OTHER_LOGS_LIMIT));

  return selected;
}

const CONFIG_FILES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'config.yaml', description: 'Overdeck config' },
  { name: 'projects.yaml', description: 'Registered projects config' },
];

export async function collectFiles(options: {
  overdeckHome: string;
  logsDir: string;
  skillPath?: string;
}): Promise<CollectorOutcome> {
  const entries: BundleEntry[] = [];
  const failures: CollectorFailure[] = [];

  for (const { name, description } of CONFIG_FILES) {
    const bundlePath = `config/${name}`;
    const filePath = join(options.overdeckHome, name);
    try {
      const content = await readFile(filePath, 'utf-8');
      entries.push({ path: bundlePath, content, kind: 'config', description });
    } catch (error) {
      failures.push({
        source: bundlePath,
        reason: (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'not found' : errorMessage(error),
      });
    }
  }

  const logFiles = await selectLogFiles(options.logsDir);
  for (const { name, filePath } of logFiles) {
    const bundlePath = `logs/${name}`;
    try {
      const content = await tailLogFile(filePath);
      entries.push({ path: bundlePath, content, kind: 'text', description: `Tail of ${name}` });
    } catch (error) {
      failures.push({ source: bundlePath, reason: errorMessage(error) });
    }
  }

  const skillPath = options.skillPath ?? join(SYNC_SOURCES.skills, 'pan-diagnose', 'SKILL.md');
  try {
    const content = await readFile(skillPath, 'utf-8');
    entries.push({
      path: 'TROUBLESHOOTING.md',
      content,
      kind: 'text',
      description: 'Copy of the pan-diagnose troubleshooting skill',
    });
  } catch (error) {
    failures.push({
      source: 'TROUBLESHOOTING.md',
      reason: (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'not found' : errorMessage(error),
    });
  }

  return { entries, failures };
}
