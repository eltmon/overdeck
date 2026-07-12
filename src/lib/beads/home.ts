import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { findProjectByPathSync, type ProjectConfig } from '../projects.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';
import { detectLiveDoltLayout } from './dolt-layout.js';

export function resolveCanonicalBeadsHome(
  workspacePath = process.cwd(),
  project: ProjectConfig | null = findProjectByPathSync(workspacePath),
): string | null {
  if (!project) return null;
  const stateHome = resolveStateReadHomeSync(project);
  return resolve(stateHome.migrated ? stateHome.root : project.path, '.beads');
}

function readProjectId(beadsDir: string): string | null {
  for (const name of ['metadata.json', 'config.json']) {
    try {
      const value = JSON.parse(readFileSync(join(beadsDir, name), 'utf8')) as Record<string, unknown>;
      const id = value.project_id ?? value.projectId;
      if (typeof id === 'string' && id.trim()) return id.trim();
    } catch {}
  }
  try {
    const config = readFileSync(join(beadsDir, 'config.yaml'), 'utf8');
    return /^project[_-]id\s*:\s*['"]?([^'"\s]+)['"]?\s*$/mi.exec(config)?.[1] ?? null;
  } catch {
    return null;
  }
}

export interface BeadsSplitBrain {
  projectId: string;
  paths: [string, string];
}

export function detectCanonicalBeadsSplitBrain(project: ProjectConfig): BeadsSplitBrain | null {
  const state = resolveStateReadHomeSync(project);
  const legacy = resolve(project.path, '.beads');
  const canonical = resolve(state.root, '.beads');
  if (!state.migrated || legacy === canonical || !existsSync(legacy) || !existsSync(canonical)) return null;
  if (!detectLiveDoltLayout(legacy) || !detectLiveDoltLayout(canonical)) return null;
  const legacyId = readProjectId(legacy);
  const canonicalId = readProjectId(canonical);
  return legacyId && legacyId === canonicalId ? { projectId: legacyId, paths: [legacy, canonical] } : null;
}
