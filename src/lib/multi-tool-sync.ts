/**
 * Multi-Tool Skill Sync
 *
 * Deprecated compatibility surface for the retired `tools.also_sync` option.
 *
 * Configured via `tools.also_sync` in ~/.overdeck/config.yaml and .pan.yaml.
 * Per-project .pan.yaml values are merged additively with global config.
 *
 * PAN-3779 makes every harness-native repository file user-owned. These APIs
 * remain temporarily so old config and callers do not crash, but they never
 * create or mutate repository files.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { Effect } from 'effect';
import { FsError } from './errors.js';
import { OVERDECK_HOME } from './paths.js';

export type AlsoSyncTool = 'cursor' | 'codex' | 'windsurf' | 'cline' | 'copilot' | 'aider';

export interface MultiToolSyncResult {
  tool: AlsoSyncTool;
  written: string[];
  skipped: string[];
  errors: string[];
}

/** Collect all skill directories from the given skills root */
function collectSkillDirs(skillsDir: string): Array<{ name: string; dir: string }> {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, dir: join(skillsDir, e.name) }));
}

const RETIRED_TOOLS = new Set<AlsoSyncTool>(['cursor', 'codex', 'windsurf', 'cline', 'copilot', 'aider']);

/**
 * Resolve the merged list of tools to sync.
 * Global config is the base; per-project .pan.yaml adds more (never removes).
 */
export function resolveAlsoSyncToolsSync(projectPath?: string): AlsoSyncTool[] {
  const tools = new Set<AlsoSyncTool>();

  // Read from global config
  const globalConfig = join(OVERDECK_HOME, 'config.yaml');
  if (existsSync(globalConfig)) {
    try {
      const parsed = yaml.load(readFileSync(globalConfig, 'utf-8')) as any;
      const globalTools: string[] = parsed?.tools?.also_sync || [];
      for (const t of globalTools) {
        if (RETIRED_TOOLS.has(t as AlsoSyncTool)) tools.add(t as AlsoSyncTool);
      }
    } catch { /* ignore parse errors */ }
  }

  // Merge per-project .pan.yaml (additive)
  if (projectPath) {
    const panYaml = join(projectPath, '.pan.yaml');
    const legacyYaml = join(projectPath, '.overdeck.yaml');
    const configPath = existsSync(panYaml) ? panYaml : existsSync(legacyYaml) ? legacyYaml : null;
    if (configPath) {
      try {
        const parsed = yaml.load(readFileSync(configPath, 'utf-8')) as any;
        const projectTools: string[] = parsed?.tools?.also_sync || [];
        for (const t of projectTools) {
          if (RETIRED_TOOLS.has(t as AlsoSyncTool)) tools.add(t as AlsoSyncTool);
        }
      } catch { /* ignore parse errors */ }
    }
  }

  return Array.from(tools);
}

/**
 * Report skills that would previously have been synced. No repository files
 * are touched; every entry is returned as skipped.
 *
 * @param skillsDir  Directory containing skill subdirectories
 * @param projectPath  Project root where tool targets live
 * @param tools  Tools to sync to (from resolveAlsoSyncTools)
 */
export function syncSkillsToToolsSync(
  skillsDir: string,
  projectPath: string,
  tools: AlsoSyncTool[],
): MultiToolSyncResult[] {
  if (tools.length === 0 || !existsSync(skillsDir)) return [];

  void projectPath;
  const names = collectSkillDirs(skillsDir).map(({ name }) => name);
  return tools.map((tool) => ({ tool, written: [], skipped: [...names], errors: [] }));
}

/**
 * Run the full multi-tool sync for a project.
 * Sources: .pan/skills/ (project-local) and/or ~/.overdeck/skills/ (global).
 */
export function runMultiToolSyncSync(projectPath: string): MultiToolSyncResult[] {
  const tools = resolveAlsoSyncToolsSync(projectPath);
  if (tools.length === 0) return [];

  const allResults: MultiToolSyncResult[] = [];

  // 1. Global skills (from ~/.overdeck/skills/)
  const globalSkillsDir = join(OVERDECK_HOME, 'skills');
  const globalResults = syncSkillsToToolsSync(globalSkillsDir, projectPath, tools);
  allResults.push(...globalResults);

  // 2. Project-local skills (from .pan/skills/) — may overwrite global skill entries
  const projectSkillsDir = join(projectPath, '.pan', 'skills');
  if (existsSync(projectSkillsDir)) {
    const projectResults = syncSkillsToToolsSync(projectSkillsDir, projectPath, tools);
    // Merge into existing results (project results override counts, don't duplicate tools)
    for (const pr of projectResults) {
      const existing = allResults.find(r => r.tool === pr.tool);
      if (existing) {
        existing.written.push(...pr.written);
        existing.errors.push(...pr.errors);
      } else {
        allResults.push(pr);
      }
    }
  }

  return allResults;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of {@link resolveAlsoSyncToolsSync}. Pure config read; cannot fail. */
export const resolveAlsoSyncTools = (projectPath?: string): Effect.Effect<AlsoSyncTool[], never> =>
  Effect.sync(() => resolveAlsoSyncToolsSync(projectPath));

/** Effect variant of {@link syncSkillsToToolsSync}. */
export const syncSkillsToTools = (
  skillsDir: string,
  projectPath: string,
  tools: AlsoSyncTool[],
): Effect.Effect<MultiToolSyncResult[], FsError> =>
  Effect.try({
    try: () => syncSkillsToToolsSync(skillsDir, projectPath, tools),
    catch: (cause) => new FsError({ path: skillsDir, operation: 'syncSkillsToTools', cause }),
  });

/** Effect variant of {@link runMultiToolSyncSync}. */
export const runMultiToolSync = (projectPath: string): Effect.Effect<MultiToolSyncResult[], FsError> =>
  Effect.try({
    try: () => runMultiToolSyncSync(projectPath),
    catch: (cause) => new FsError({ path: projectPath, operation: 'runMultiToolSync', cause }),
  });
