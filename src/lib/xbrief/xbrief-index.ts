/**
 * xBRIEF Index — async, cached issue→xBRIEF lookups for server hot paths.
 *
 * The canonical spec store is the `specs/` directory resolved by
 * `getProjectPanPaths()` — `overdeck-state` for a migrated project, legacy
 * `<projectRoot>/.pan/specs` otherwise. Legacy `vbrief/<lifecycle>/`
 * directories remain as fallback reads when no spec entry exists for an issue.
 */
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';

import {
  LEGACY_VBRIEF_LIFECYCLE_DIRS,
  parseXBriefFilename,
  resolveXBriefDir,
  type XBriefLifecycleDir,
} from './lifecycle.js';
import type { XBriefDocument } from './types.js';
import { normalizeXBriefEnvelope, XBriefInvalidFormatError, XBriefMergeConflictTaggedError, type XBriefReadError } from './io.js';
import { FsError } from '../errors.js';
import { isPanSpecStatus } from '../pan-dir/types.js';
import { getProjectPanPaths } from '../pan-dir/paths.js';

const CACHE_TTL_MS = 5_000;

interface IndexEntry {
  path: string;
  lifecycleDir: XBriefLifecycleDir;
  issueId: string;
  slug: string;
  date: string;
  filename: string;
}

interface ProjectIndex {
  byIssue: Map<string, IndexEntry>;
  entries: IndexEntry[];
  builtAt: number;
}

const projectIndexCache = new Map<string, ProjectIndex>();

async function scanPanSpecs(projectRoot: string): Promise<IndexEntry[]> {
  // PAN-3165: resolve through the shared path authority. Hardcoding
  // `<projectRoot>/.pan/specs` here read the pre-PAN-2541 in-repo location, so
  // every spec written to `overdeck-state` since the cutover resolved to null —
  // and the UAT panel rendered that lookup miss as "No UAT steps in plan".
  const { specsDir } = getProjectPanPaths(projectRoot);
  if (!existsSync(specsDir)) return [];

  let names: string[];
  try {
    names = await readdir(specsDir);
  } catch {
    return [];
  }

  const entries = await Promise.all(names.map(async (name) => {
    const parts = parseXBriefFilename(name);
    if (!parts) return null;

    const path = join(specsDir, name);
    try {
      const raw = await readFile(path, 'utf-8');
      if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
        return null;
      }
      const parsed = JSON.parse(raw) as { status?: unknown };
      if (!isPanSpecStatus(parsed.status)) {
        return null;
      }
      return {
        path,
        lifecycleDir: parsed.status,
        issueId: parts.issueId,
        slug: parts.slug,
        date: parts.date,
        filename: name,
      } satisfies IndexEntry;
    } catch {
      return null;
    }
  }));

  return entries.filter((entry): entry is IndexEntry => entry !== null);
}

async function buildProjectIndex(projectRoot: string): Promise<ProjectIndex> {
  const byIssue = new Map<string, IndexEntry>();
  const entries: IndexEntry[] = [];

  for (const entry of await scanPanSpecs(projectRoot)) {
    entries.push(entry);
    if (!byIssue.has(entry.issueId)) {
      byIssue.set(entry.issueId, entry);
    }
  }

  for (const lifecycleDir of LEGACY_VBRIEF_LIFECYCLE_DIRS) {
    const dirPath = resolveXBriefDir(projectRoot, lifecycleDir);
    if (!existsSync(dirPath)) continue;
    let names: string[];
    try {
      names = await readdir(dirPath);
    } catch {
      continue;
    }
    for (const name of names) {
      const parts = parseXBriefFilename(name);
      if (!parts || byIssue.has(parts.issueId)) continue;
      const entry: IndexEntry = {
        path: join(dirPath, name),
        lifecycleDir,
        issueId: parts.issueId,
        slug: parts.slug,
        date: parts.date,
        filename: name,
      };
      entries.push(entry);
      byIssue.set(parts.issueId, entry);
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

export function invalidateXBriefIndex(projectRoot: string): void {
  projectIndexCache.delete(projectRoot);
}

export function resetXBriefIndex(): void {
  projectIndexCache.clear();
}

export interface FoundXBrief {
  path: string;
  lifecycleDir: XBriefLifecycleDir;
  issueId: string;
  slug: string;
  date: string;
  filename: string;
}


export const findXBriefByIssue = (
  projectRoot: string,
  issueId: string,
): Effect.Effect<FoundXBrief | null, FsError> =>
  Effect.tryPromise({
    try: async () => {
      const upper = issueId.toUpperCase();
      const index = await getOrBuildIndex(projectRoot);
      return index.byIssue.get(upper) ?? null;
    },
    catch: (cause) => new FsError({ path: projectRoot, operation: 'findXBriefByIssue', cause }),
  });

export const listXBriefs = (
  projectRoot: string,
): Effect.Effect<FoundXBrief[], FsError> =>
  Effect.tryPromise({
    try: async () => {
      const index = await getOrBuildIndex(projectRoot);
      return [...index.entries];
    },
    catch: (cause) => new FsError({ path: projectRoot, operation: 'listXBriefs', cause }),
  });

export const readXBriefDocument = (
  path: string,
): Effect.Effect<XBriefDocument, XBriefReadError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(path, 'utf-8'),
      catch: (cause) => new FsError({ path, operation: 'readFile', cause }),
    });
    if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
      return yield* Effect.fail(new XBriefMergeConflictTaggedError({ planPath: path }));
    }
    let parsed: unknown;
    try {
      parsed = normalizeXBriefEnvelope(JSON.parse(raw));
    } catch (cause) {
      return yield* Effect.fail(
        new XBriefInvalidFormatError({ planPath: path, reason: `invalid JSON: ${(cause as Error).message}` }),
      );
    }
    const obj = parsed as { xBRIEFInfo?: unknown; plan?: unknown };
    if (!obj || !obj.xBRIEFInfo || !obj.plan) {
      return yield* Effect.fail(
        new XBriefInvalidFormatError({
          planPath: path,
          reason: `missing 'xBRIEFInfo' or 'vBRIEFInfo' and/or 'plan' top-level keys`,
        }),
      );
    }
    return obj as XBriefDocument;
  });
