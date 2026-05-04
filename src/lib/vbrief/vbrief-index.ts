/**
 * vBRIEF Index — async, cached issue→vBRIEF lookups for server hot paths.
 *
 * Routes like `/api/issues`, `/api/workspaces/:id/plan`, and
 * `/api/planning/:id/status` previously called `findVBriefByIssue` synchronously
 * on every request, scanning all four lifecycle directories under
 * `<projectRoot>/vbrief/` with `readdirSync`. Each scan blocks the Node event
 * loop, freezing terminal streaming and other concurrent requests.
 *
 * This module exposes async filesystem APIs and a per-project cache so route
 * handlers and `IssueDataService` can resolve vBRIEFs in O(1) for the
 * common case. Mutations elsewhere (lifecycle moves, promotions, deletes)
 * invalidate the cache via `invalidateVBriefIndex`.
 */
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import {
  VBRIEF_LIFECYCLE_DIRS,
  parseVBriefFilename,
  resolveVBriefDir,
  type VBriefLifecycleDir,
} from './lifecycle.js';
import type { VBriefDocument } from './types.js';
import { VBriefMergeConflictError } from './io.js';

/** TTL (ms) for cached lifecycle directory listings. */
const CACHE_TTL_MS = 5_000;

/** Single entry in the per-project lifecycle index. */
interface IndexEntry {
  /** Absolute path to the vBRIEF file. */
  path: string;
  /** Lifecycle directory the vBRIEF is in. */
  lifecycleDir: VBriefLifecycleDir;
  /** Issue ID (uppercased — matches filename). */
  issueId: string;
  /** Slug from filename. */
  slug: string;
  /** YYYY-MM-DD date prefix from filename. */
  date: string;
  /** Filename only (without directory). */
  filename: string;
}

interface ProjectIndex {
  /** issueId (UPPERCASE) → entry */
  byIssue: Map<string, IndexEntry>;
  /** All entries (for list operations). */
  entries: IndexEntry[];
  /** Wall-clock ms when this snapshot was built. */
  builtAt: number;
}

const projectIndexCache = new Map<string, ProjectIndex>();

/**
 * Build (or rebuild) the per-project index by scanning all four lifecycle
 * directories asynchronously. Discovery priority across lifecycle dirs follows
 * `VBRIEF_LIFECYCLE_DIRS` order (proposed → active → completed → cancelled);
 * the first match for a given issue wins, matching the synchronous
 * `findVBriefByIssue` semantics.
 */
async function buildProjectIndex(projectRoot: string): Promise<ProjectIndex> {
  const byIssue = new Map<string, IndexEntry>();
  const entries: IndexEntry[] = [];

  for (const lifecycleDir of VBRIEF_LIFECYCLE_DIRS) {
    const dirPath = resolveVBriefDir(projectRoot, lifecycleDir);
    if (!existsSync(dirPath)) continue;
    let names: string[];
    try {
      names = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const name of names) {
      const parts = parseVBriefFilename(name);
      if (!parts) continue;
      const entry: IndexEntry = {
        path: join(dirPath, name),
        lifecycleDir,
        issueId: parts.issueId,
        slug: parts.slug,
        date: parts.date,
        filename: name,
      };
      entries.push(entry);
      // First match wins, mirroring sync findVBriefByIssue priority order.
      if (!byIssue.has(parts.issueId)) {
        byIssue.set(parts.issueId, entry);
      }
    }
  }

  return { byIssue, entries, builtAt: Date.now() };
}

async function getOrBuildIndex(projectRoot: string): Promise<ProjectIndex> {
  const cached = projectIndexCache.get(projectRoot);
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) {
    return cached;
  }
  const fresh = await buildProjectIndex(projectRoot);
  projectIndexCache.set(projectRoot, fresh);
  return fresh;
}

/**
 * Manually invalidate the cached index for a project. Call this after any
 * mutation that changes which lifecycle dir holds an issue's vBRIEF (move,
 * promote, delete, transition).
 */
export function invalidateVBriefIndex(projectRoot: string): void {
  projectIndexCache.delete(projectRoot);
}

/** Drop all cached indices. Useful for tests. */
export function resetVBriefIndex(): void {
  projectIndexCache.clear();
}

/** Async result of a vBRIEF lookup. The document is loaded lazily on demand. */
export interface FoundVBriefAsync {
  path: string;
  lifecycleDir: VBriefLifecycleDir;
  issueId: string;
  slug: string;
  date: string;
  filename: string;
}

/**
 * Async, cached version of `findVBriefByIssue`. Returns the vBRIEF location
 * for an issue, scanning lifecycle directories in priority order. Does NOT
 * read the document body — call {@link readVBriefDocumentAsync} separately if
 * you need the parsed plan (most callers only want the path/lifecycleDir).
 *
 * Returns null if no vBRIEF exists for the issue.
 */
export async function findVBriefByIssueAsync(
  projectRoot: string,
  issueId: string,
): Promise<FoundVBriefAsync | null> {
  const upper = issueId.toUpperCase();
  const index = await getOrBuildIndex(projectRoot);
  return index.byIssue.get(upper) ?? null;
}

/**
 * Async list of all vBRIEFs in the project across lifecycle directories.
 * Returns location info only — caller reads documents on demand.
 */
export async function listVBriefsAsync(projectRoot: string): Promise<FoundVBriefAsync[]> {
  const index = await getOrBuildIndex(projectRoot);
  // Return a copy to keep the cache immutable from the caller's perspective.
  return [...index.entries];
}

/**
 * Read and parse a vBRIEF JSON file asynchronously. Surfaces merge-conflict
 * markers as a `VBriefMergeConflictError` for parity with the sync `readPlan`.
 */
export async function readVBriefDocumentAsync(path: string): Promise<VBriefDocument> {
  const raw = await readFile(path, 'utf-8');
  if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
    throw new VBriefMergeConflictError(path);
  }
  const parsed = JSON.parse(raw);
  if (parsed.vBRIEFInfo && parsed.plan) {
    return parsed as VBriefDocument;
  }
  throw new Error(
    `Invalid vBRIEF format in ${path}: missing 'vBRIEFInfo' and/or 'plan' top-level keys.`,
  );
}
