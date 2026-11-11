/**
 * PAN-5093: the read-only space holder collector for the disk alert. Measures
 * the biggest directories and files on the same filesystem as the Overdeck
 * home, plus Docker's reclaimable bytes, so the operator sees what to delete.
 * Nothing here deletes, prunes or moves anything. All I/O is injectable; no
 * `execSync`.
 */

import { execFile } from 'node:child_process';
import { stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DiskAlertHolders, DiskSpaceHolder } from '@overdeck/contracts';
import { createPromiseConcurrencyLimiter } from './concurrency.js';
import { getOverdeckHome } from './paths.js';
import { claudeProjectsRoot } from './runtimes/storage/claude-code.js';
import { parseDockerSize } from './workspace/disk-cost.js';

const execFileAsync = promisify(execFile);

export const HOLDER_DU_TIMEOUT_MS = 120_000;
export const HOLDER_DU_CONCURRENCY = 4;
export const HOLDER_LIST_MAX = 12;
export const HOLDER_MIN_BYTES = 100 * 1024 ** 2;

export interface StatEntryResult {
  dev: number;
  size: number;
  isDirectory: boolean;
}

export interface HolderDeps {
  home: string;
  overdeckHome: string;
  /** (await loadGlobalConfigNoMigration()).config.conversationSearch.dbPath, resolved by the caller. */
  conversationIndexPath: string;
  defaultIndexPath: string;
  duKb: (path: string) => Promise<number>;
  statEntry: (path: string) => Promise<StatEntryResult | null>;
  listDir: (path: string) => Promise<string[]>;
  dockerReclaimableBytes: () => Promise<number | null>;
  now: () => number;
}

async function defaultStatEntry(path: string): Promise<StatEntryResult | null> {
  try {
    const stats = await stat(path);
    return { dev: stats.dev, size: stats.size, isDirectory: stats.isDirectory() };
  } catch {
    return null;
  }
}

async function defaultListDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function defaultDuKb(path: string): Promise<number> {
  const { stdout } = await execFileAsync('du', ['-sk', '-x', path], { timeout: HOLDER_DU_TIMEOUT_MS });
  const kb = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10);
  if (!Number.isFinite(kb)) throw new Error(`du produced no size for ${path}`);
  return kb;
}

/** Sum every JSON line's `Reclaimable` column (e.g. `"1.5GB (40%)"`); 0 for empty input. */
export function parseDockerReclaimable(jsonLines: string): number {
  let total = 0;
  for (const line of jsonLines.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: { Reclaimable?: unknown };
    try {
      parsed = JSON.parse(trimmed) as { Reclaimable?: unknown };
    } catch {
      continue;
    }
    if (typeof parsed.Reclaimable !== 'string') continue;
    const withoutPercent = parsed.Reclaimable.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const bytes = parseDockerSize(withoutPercent);
    if (Number.isFinite(bytes)) total += bytes;
  }
  return total;
}

async function defaultDockerReclaimableBytes(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['system', 'df', '--format', '{{json .}}'], { timeout: 60_000 });
    return parseDockerReclaimable(stdout);
  } catch {
    return null;
  }
}

function resolveDeps(deps: Partial<HolderDeps>): HolderDeps {
  const overdeckHome = deps.overdeckHome ?? getOverdeckHome();
  const defaultIndexPath = deps.defaultIndexPath ?? join(overdeckHome, 'conversations', 'embeddings.db');
  return {
    home: deps.home ?? homedir(),
    overdeckHome,
    conversationIndexPath: deps.conversationIndexPath ?? defaultIndexPath,
    defaultIndexPath,
    duKb: deps.duKb ?? defaultDuKb,
    statEntry: deps.statEntry ?? defaultStatEntry,
    listDir: deps.listDir ?? defaultListDir,
    dockerReclaimableBytes: deps.dockerReclaimableBytes ?? defaultDockerReclaimableBytes,
    now: deps.now ?? Date.now,
  };
}

interface Candidate { label: string; path: string }

/** Display a path under `home` as `~/...`, so a storage module's own path never needs a duplicate literal here. */
function tildeLabel(home: string, path: string): string {
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function cacheCandidates(home: string): Candidate[] {
  return [
    { label: '~/.local/share/pnpm/store', path: join(home, '.local', 'share', 'pnpm', 'store') },
    { label: '~/.cache/huggingface', path: join(home, '.cache', 'huggingface') },
    { label: '~/.cache/ms-playwright', path: join(home, '.cache', 'ms-playwright') },
    { label: '~/.npm/_cacache', path: join(home, '.npm', '_cacache') },
    { label: '~/.bun/install/cache', path: join(home, '.bun', 'install', 'cache') },
    { label: '~/.cache/uv', path: join(home, '.cache', 'uv') },
  ];
}

/**
 * Measure the biggest directories/files on the Overdeck home's filesystem and
 * Docker's reclaimable bytes. Read-only: nothing is deleted, pruned or moved.
 */
export async function collectDiskHolders(deps: Partial<HolderDeps> = {}): Promise<DiskAlertHolders> {
  const d = resolveDeps(deps);
  const measuredAt = new Date(d.now()).toISOString();

  const homeEntry = await d.statEntry(d.overdeckHome);
  if (!homeEntry) {
    return { measuredAt, incomplete: true, holders: [] };
  }
  const homeDev = homeEntry.dev;

  const overdeckHomeChildren = await d.listDir(d.overdeckHome);
  const claudeProjectsPath = claudeProjectsRoot(d.home);
  const candidates: Candidate[] = [
    ...overdeckHomeChildren.map((name) => ({ label: `~/.overdeck/${name}`, path: join(d.overdeckHome, name) })),
    { label: tildeLabel(d.home, claudeProjectsPath), path: claudeProjectsPath },
    { label: '~/.local/share/opencode/opencode.db', path: join(d.home, '.local', 'share', 'opencode', 'opencode.db') },
    ...cacheCandidates(d.home),
  ];

  const indexCandidates: Candidate[] = [
    { label: 'Conversation search index', path: d.conversationIndexPath },
  ];
  if (d.defaultIndexPath !== d.conversationIndexPath) {
    indexCandidates.push({ label: 'Conversation search index (not in use)', path: d.defaultIndexPath });
  }

  let incomplete = false;
  const limit = createPromiseConcurrencyLimiter(HOLDER_DU_CONCURRENCY);

  async function measure(candidate: Candidate): Promise<DiskSpaceHolder | null> {
    const entry = await d.statEntry(candidate.path);
    if (!entry || entry.dev !== homeDev) return null;
    if (!entry.isDirectory) return { label: candidate.label, path: candidate.path, bytes: entry.size };
    try {
      const kb = await limit(() => d.duKb(candidate.path));
      return { label: candidate.label, path: candidate.path, bytes: kb * 1024 };
    } catch {
      incomplete = true;
      return null;
    }
  }

  const [measuredRows, measuredIndexRows] = await Promise.all([
    Promise.all(candidates.map(measure)),
    Promise.all(indexCandidates.map(measure)),
  ]);

  const rows = measuredRows.filter((row): row is DiskSpaceHolder => row !== null);
  const indexRows = measuredIndexRows.filter((row): row is DiskSpaceHolder => row !== null);

  const dockerBytes = await d.dockerReclaimableBytes();
  if (dockerBytes !== null && dockerBytes > 0) {
    rows.push({ label: 'Docker reclaimable', path: null, bytes: dockerBytes });
  }

  const sorted = [...rows].sort((a, b) => b.bytes - a.bytes);
  const kept = sorted.filter((row) => row.bytes >= HOLDER_MIN_BYTES).slice(0, HOLDER_LIST_MAX);

  for (const indexRow of indexRows) {
    if (!kept.some((row) => row.label === indexRow.label)) kept.push(indexRow);
  }

  return { measuredAt, incomplete, holders: kept };
}
