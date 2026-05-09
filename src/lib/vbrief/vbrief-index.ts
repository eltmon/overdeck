/**
 * vBRIEF Index — async, cached issue→vBRIEF lookups for server hot paths.
 *
 * PAN-967 Phase 2 makes `.pan/specs/` the canonical spec store. During the
 * migration window, legacy `vbrief/<lifecycle>/` directories remain as fallback
 * reads when no `.pan/specs` entry exists for an issue.
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
import { PAN_DIRNAME, PAN_SPECS_DIRNAME, isPanSpecStatus } from '../pan-dir/types.js';

const CACHE_TTL_MS = 5_000;

interface IndexEntry {
  path: string;
  lifecycleDir: VBriefLifecycleDir;
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
  const specsDir = join(projectRoot, PAN_DIRNAME, PAN_SPECS_DIRNAME);
  if (!existsSync(specsDir)) return [];

  let names: string[];
  try {
    names = await readdir(specsDir);
  } catch {
    return [];
  }

  const entries = await Promise.all(names.map(async (name) => {
    const parts = parseVBriefFilename(name);
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

export function invalidateVBriefIndex(projectRoot: string): void {
  projectIndexCache.delete(projectRoot);
}

export function resetVBriefIndex(): void {
  projectIndexCache.clear();
}

export interface FoundVBriefAsync {
  path: string;
  lifecycleDir: VBriefLifecycleDir;
  issueId: string;
  slug: string;
  date: string;
  filename: string;
}

export async function findVBriefByIssueAsync(
  projectRoot: string,
  issueId: string,
): Promise<FoundVBriefAsync | null> {
  const upper = issueId.toUpperCase();
  const index = await getOrBuildIndex(projectRoot);
  return index.byIssue.get(upper) ?? null;
}

export async function listVBriefsAsync(projectRoot: string): Promise<FoundVBriefAsync[]> {
  const index = await getOrBuildIndex(projectRoot);
  return [...index.entries];
}

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
