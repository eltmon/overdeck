import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { readFile } from 'node:fs/promises';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export interface BeadEntry {
  id: string;
  title: string;
  status: string;
  labels: string[];
  description?: string;
  priority?: number;
  [key: string]: unknown;
}

async function readBeadsFromJsonl(workspacePath: string, issueId: string): Promise<BeadEntry[]> {
  try {
    const jsonlPath = join(workspacePath, '.beads', 'issues.jsonl');
    if (!existsSync(jsonlPath)) return [];
    const raw = await readFile(jsonlPath, 'utf-8');
    const beads: BeadEntry[] = [];
    const label = issueId.toLowerCase();
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const labels: string[] = Array.isArray(entry.labels) ? entry.labels : [];
        if (labels.some((l: string) => l.toLowerCase() === label || l.toLowerCase() === `workspace:${label}`)) {
          beads.push({
            id: String(entry.id ?? ''),
            title: String(entry.title ?? ''),
            status: String(entry.status ?? 'open'),
            labels,
            description: entry.description,
            priority: entry.priority,
          });
        }
      } catch { /* skip malformed lines */ }
    }
    return beads;
  } catch {
    return [];
  }
}

/**
 * Query beads for an issue from the live Dolt database via `bd list`.
 * Falls back to `.beads/issues.jsonl` when bd is unavailable.
 * Returns an empty array on any failure (bd not installed, Dolt down, no beads).
 */
export async function queryBeadsForIssue(
  workspacePath: string,
  issueId: string
): Promise<BeadEntry[]> {
  try {
    const { stdout } = await execFileAsync(
      'bd',
      ['list', '--json', '-l', issueId.toLowerCase(), '--status', 'all', '--limit', '0'],
      { encoding: 'utf-8', cwd: workspacePath, timeout: 10000 }
    );
    const parsed = JSON.parse(stdout || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return await readBeadsFromJsonl(workspacePath, issueId);
  }
}

/**
 * Look up a single bead by ID from the live Dolt database via `bd show`.
 * Returns null on any failure.
 */
export async function queryBeadById(
  workspacePath: string,
  beadId: string
): Promise<BeadEntry | null> {
  try {
    const { stdout } = await execFileAsync(
      'bd',
      ['show', beadId, '--json'],
      { encoding: 'utf-8', cwd: workspacePath, timeout: 10000 }
    );
    const parsed = JSON.parse(stdout || '[]');
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr[0] ?? null;
  } catch {
    return null;
  }
}
