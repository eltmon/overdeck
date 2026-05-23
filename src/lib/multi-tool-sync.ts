/**
 * Multi-Tool Skill Sync
 *
 * Writes Panopticon skills to other AI tool formats so skills authored once
 * in .pan/skills/ are available across all configured tools.
 *
 * Configured via `tools.also_sync` in ~/.panopticon/config.yaml and .pan.yaml.
 * Per-project .pan.yaml values are merged additively with global config.
 *
 * Supported targets:
 *   cursor    → .cursor/rules/<skill-name>.mdc
 *   codex     → AGENTS.md (named blocks)
 *   windsurf  → .windsurf/rules/<skill-name>.md
 *   cline     → .clinerules/<skill-name>.md
 *   copilot   → .github/instructions/<skill-name>.instructions.md
 *   aider     → CONVENTIONS.md (named blocks)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yaml from 'js-yaml';
import { Effect } from 'effect';
import { FsError } from './errors.js';
import { PANOPTICON_HOME } from './paths.js';

export type AlsoSyncTool = 'cursor' | 'codex' | 'windsurf' | 'cline' | 'copilot' | 'aider';

export interface MultiToolSyncResult {
  tool: AlsoSyncTool;
  written: string[];
  skipped: string[];
  errors: string[];
}

/** Strip YAML frontmatter from a skill markdown file */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

/** Extract the skill name from frontmatter, or fall back to dir name */
function extractSkillName(content: string, fallback: string): string {
  if (!content.startsWith('---')) return fallback;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return fallback;
  const frontmatter = content.slice(4, end);
  const match = frontmatter.match(/^name:\s*(.+)$/m);
  return match ? match[1].trim() : fallback;
}

/** Read main SKILL.md content for a skill directory */
function readSkillContent(skillDir: string): string | null {
  const skillMd = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    // Fallback: any .md file in root
    const files = existsSync(skillDir) ? readdirSync(skillDir).filter(f => f.endsWith('.md')) : [];
    if (files.length === 0) return null;
    return readFileSync(join(skillDir, files[0]), 'utf-8');
  }
  return readFileSync(skillMd, 'utf-8');
}

/** Collect all skill directories from the given skills root */
function collectSkillDirs(skillsDir: string): Array<{ name: string; dir: string }> {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, dir: join(skillsDir, e.name) }));
}

/**
 * Update or insert a named block in a file.
 * Blocks are delimited by: <!-- panopticon:<skill-name> start --> ... <!-- panopticon:<skill-name> end -->
 */
function upsertNamedBlock(filePath: string, blockName: string, content: string): void {
  const startTag = `<!-- panopticon:${blockName} start -->`;
  const endTag = `<!-- panopticon:${blockName} end -->`;
  const block = `${startTag}\n${content}\n${endTag}`;

  let existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';

  const startIdx = existing.indexOf(startTag);
  const endIdx = existing.indexOf(endTag);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block
    existing = existing.slice(0, startIdx) + block + existing.slice(endIdx + endTag.length);
  } else {
    // Append new block
    if (existing.length > 0 && !existing.endsWith('\n')) existing += '\n';
    existing += '\n' + block + '\n';
  }

  writeFileSync(filePath, existing, 'utf-8');
}

/** Sync a single skill to the cursor target */
function syncToCursor(projectPath: string, skillName: string, rawContent: string): void {
  const rulesDir = join(projectPath, '.cursor', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  const body = stripFrontmatter(rawContent);
  // .mdc files: standard markdown, cursor accepts them as context rules
  writeFileSync(join(rulesDir, `${skillName}.mdc`), body, 'utf-8');
}

/** Sync a single skill to the windsurf target */
function syncToWindsurf(projectPath: string, skillName: string, rawContent: string): void {
  const rulesDir = join(projectPath, '.windsurf', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, `${skillName}.md`), stripFrontmatter(rawContent), 'utf-8');
}

/** Sync a single skill to the cline target */
function syncToCline(projectPath: string, skillName: string, rawContent: string): void {
  const rulesDir = join(projectPath, '.clinerules');
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, `${skillName}.md`), stripFrontmatter(rawContent), 'utf-8');
}

/** Sync a single skill to the copilot target */
function syncToCopilot(projectPath: string, skillName: string, rawContent: string): void {
  const instructionsDir = join(projectPath, '.github', 'instructions');
  mkdirSync(instructionsDir, { recursive: true });
  writeFileSync(
    join(instructionsDir, `${skillName}.instructions.md`),
    stripFrontmatter(rawContent),
    'utf-8',
  );
}

/** Sync a single skill to AGENTS.md (codex) as a named block */
function syncToCodex(projectPath: string, skillName: string, rawContent: string): void {
  const agentsMd = join(projectPath, 'AGENTS.md');
  upsertNamedBlock(agentsMd, skillName, `## ${skillName}\n\n${stripFrontmatter(rawContent)}`);
}

/** Sync a single skill to CONVENTIONS.md (aider) as a named block */
function syncToAider(projectPath: string, skillName: string, rawContent: string): void {
  const conventionsMd = join(projectPath, 'CONVENTIONS.md');
  upsertNamedBlock(conventionsMd, skillName, `## ${skillName}\n\n${stripFrontmatter(rawContent)}`);
}

const TOOL_WRITERS: Record<AlsoSyncTool, (projectPath: string, name: string, content: string) => void> = {
  cursor: syncToCursor,
  windsurf: syncToWindsurf,
  cline: syncToCline,
  copilot: syncToCopilot,
  codex: syncToCodex,
  aider: syncToAider,
};

/**
 * Resolve the merged list of tools to sync.
 * Global config is the base; per-project .pan.yaml adds more (never removes).
 */
export function resolveAlsoSyncToolsSync(projectPath?: string): AlsoSyncTool[] {
  const tools = new Set<AlsoSyncTool>();

  // Read from global config
  const globalConfig = join(PANOPTICON_HOME, 'config.yaml');
  if (existsSync(globalConfig)) {
    try {
      const parsed = yaml.load(readFileSync(globalConfig, 'utf-8')) as any;
      const globalTools: string[] = parsed?.tools?.also_sync || [];
      for (const t of globalTools) {
        if (t in TOOL_WRITERS) tools.add(t as AlsoSyncTool);
      }
    } catch { /* ignore parse errors */ }
  }

  // Merge per-project .pan.yaml (additive)
  if (projectPath) {
    const panYaml = join(projectPath, '.pan.yaml');
    const legacyYaml = join(projectPath, '.panopticon.yaml');
    const configPath = existsSync(panYaml) ? panYaml : existsSync(legacyYaml) ? legacyYaml : null;
    if (configPath) {
      try {
        const parsed = yaml.load(readFileSync(configPath, 'utf-8')) as any;
        const projectTools: string[] = parsed?.tools?.also_sync || [];
        for (const t of projectTools) {
          if (t in TOOL_WRITERS) tools.add(t as AlsoSyncTool);
        }
      } catch { /* ignore parse errors */ }
    }
  }

  return Array.from(tools);
}

/**
 * Sync skills from a skills directory to all configured tools.
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

  const skills = collectSkillDirs(skillsDir);
  const results: MultiToolSyncResult[] = [];

  for (const tool of tools) {
    const writer = TOOL_WRITERS[tool];
    const result: MultiToolSyncResult = { tool, written: [], skipped: [], errors: [] };

    for (const { name, dir } of skills) {
      try {
        const rawContent = readSkillContent(dir);
        if (!rawContent) {
          result.skipped.push(name);
          continue;
        }
        const displayName = extractSkillName(rawContent, name);
        writer(projectPath, displayName, rawContent);
        result.written.push(name);
      } catch (err: any) {
        result.errors.push(`${name}: ${err.message}`);
      }
    }

    results.push(result);
  }

  return results;
}

/**
 * Run the full multi-tool sync for a project.
 * Sources: .pan/skills/ (project-local) and/or ~/.panopticon/skills/ (global).
 */
export function runMultiToolSyncSync(projectPath: string): MultiToolSyncResult[] {
  const tools = resolveAlsoSyncToolsSync(projectPath);
  if (tools.length === 0) return [];

  const allResults: MultiToolSyncResult[] = [];

  // 1. Global skills (from ~/.panopticon/skills/)
  const globalSkillsDir = join(PANOPTICON_HOME, 'skills');
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

