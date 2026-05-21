import {
  existsSync,
  readdirSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from 'fs';
import { join, relative, dirname } from 'path';
import { Effect } from 'effect';
import { SKILLS_DIR, CACHE_AGENTS_DIR, CACHE_RULES_DIR } from './paths.js';
import {
  createEmptyManifest,
  readManifest,
  writeManifest,
  collectSourceFiles,
  hashFile,
  setManifestEntry,
  compareFileToManifest,
  type Manifest,
} from './manifest.js';

export interface MergeResult {
  added: string[];
  updated: string[];
  skipped: string[];
  overlayed: string[];
}

/**
 * Copy all files from a source directory into a target directory,
 * preserving subdirectory structure. Returns the list of relative paths copied.
 */
function copyTree(sourceDir: string, targetDir: string): string[] {
  const copied: string[] = [];
  if (!existsSync(sourceDir)) return copied;

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = relative(sourceDir, fullPath);
        const targetPath = join(targetDir, rel);
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(fullPath, targetPath);
        copied.push(rel);
      }
    }
  }

  walk(sourceDir);
  return copied;
}

/**
 * Merge Panopticon skills, agents, and rules into a workspace using file copies.
 *
 * Flow:
 * 1. Copy from cache (skills, agent-definitions, rules) → workspace/.claude/
 * 2. Write manifest tracking what was placed
 *
 * Project template overlay is handled separately by workspace-manager.ts
 * (processTemplates + createSymlinks → now also copy-based).
 */
export function mergeSkillsIntoWorkspace(workspacePath: string): MergeResult {
  const claudeDir = join(workspacePath, '.claude');
  const manifestPath = join(claudeDir, '.panopticon-manifest.json');
  const manifest = Effect.runSync(
    readManifest(manifestPath).pipe(Effect.orElseSucceed(createEmptyManifest)),
  );

  const result: MergeResult = {
    added: [],
    updated: [],
    skipped: [],
    overlayed: [],
  };

  // Ensure base directories exist
  mkdirSync(join(claudeDir, 'skills'), { recursive: true });
  mkdirSync(join(claudeDir, 'agents'), { recursive: true });

  // Sources to copy: category → source cache directory
  const sources: Array<{ category: string; sourceDir: string; targetSubdir: string }> = [
    { category: 'skills', sourceDir: SKILLS_DIR, targetSubdir: 'skills' },
    { category: 'agents', sourceDir: CACHE_AGENTS_DIR, targetSubdir: 'agents' },
    { category: 'rules', sourceDir: CACHE_RULES_DIR, targetSubdir: 'rules' },
  ];

  for (const { category, sourceDir, targetSubdir } of sources) {
    if (!existsSync(sourceDir)) continue;

    const prefix = targetSubdir ? `${targetSubdir}/` : '';
    const files = Effect.runSync(collectSourceFiles(sourceDir, ''));

    for (const file of files) {
      const relativePath = `${prefix}${file.relativePath}`;
      const targetPath = join(claudeDir, relativePath);
      const sourceHash = Effect.runSync(hashFile(file.absolutePath));

      // Check status against manifest
      const status = Effect.runSync(compareFileToManifest(targetPath, relativePath, manifest));

      switch (status.action) {
        case 'new':
          // File doesn't exist at target — copy it
          mkdirSync(dirname(targetPath), { recursive: true });
          copyFileSync(file.absolutePath, targetPath);
          setManifestEntry(manifest, relativePath, sourceHash, 'panopticon');
          result.added.push(relativePath);
          break;

        case 'update':
          // File exists and matches manifest — safe to overwrite with latest
          copyFileSync(file.absolutePath, targetPath);
          setManifestEntry(manifest, relativePath, sourceHash, 'panopticon');
          result.updated.push(relativePath);
          break;

        case 'modified':
          // User modified the file — skip to preserve their changes
          result.skipped.push(`${relativePath} (modified by user)`);
          break;

        case 'user-owned':
          // File exists but wasn't placed by us — never touch
          result.skipped.push(`${relativePath} (user-owned)`);
          break;
      }
    }
  }

  // Write updated manifest
  Effect.runSync(writeManifest(manifestPath, manifest));

  return result;
}

/**
 * Apply project template overlay on top of Panopticon base files in a workspace.
 *
 * This copies files from the project's agent template directory into
 * workspace/.claude/, overwriting Panopticon files where the project
 * provides its own version. Updates the manifest with source="project-template".
 *
 * @param workspacePath - Path to the workspace
 * @param templateDir - Absolute path to the project's agent template directory
 * @param templates - Optional list of specific template files to process (source → target mappings)
 */
export function applyProjectTemplateOverlay(
  workspacePath: string,
  templateDir: string,
  templates?: Array<{ source: string; target: string }>,
): string[] {
  const claudeDir = join(workspacePath, '.claude');
  const manifestPath = join(claudeDir, '.panopticon-manifest.json');
  const manifest = Effect.runSync(
    readManifest(manifestPath).pipe(Effect.orElseSucceed(createEmptyManifest)),
  );
  const overlayed: string[] = [];

  if (!existsSync(templateDir)) return overlayed;

  if (templates && templates.length > 0) {
    // Process specific template mappings
    for (const { source, target } of templates) {
      const sourcePath = join(templateDir, source);
      if (!existsSync(sourcePath)) continue;

      const targetPath = join(workspacePath, target);
      mkdirSync(dirname(targetPath), { recursive: true });

      // Read template content and check if it's a template file
      if (source.endsWith('.template')) {
        // Template files are handled by workspace-manager's processTemplates
        // We just track them in the manifest after they're processed
        continue;
      }

      copyFileSync(sourcePath, targetPath);

      // Track in manifest if it's under .claude/
      if (target.startsWith('.claude/')) {
        const relativePath = target.slice('.claude/'.length);
        const hash = Effect.runSync(hashFile(targetPath));
        setManifestEntry(manifest, relativePath, hash, 'project-template');
        overlayed.push(relativePath);
      }
    }
  } else {
    // Copy all .claude/ subdirectories from template dir
    const claudeInTemplate = join(templateDir, '.claude');
    if (existsSync(claudeInTemplate)) {
      const copied = copyTree(claudeInTemplate, claudeDir);
      for (const rel of copied) {
        const targetPath = join(claudeDir, rel);
        const hash = Effect.runSync(hashFile(targetPath));
        setManifestEntry(manifest, rel, hash, 'project-template');
        overlayed.push(rel);
      }
    }
  }

  // Write updated manifest
  Effect.runSync(writeManifest(manifestPath, manifest));

  return overlayed;
}

// ─── Legacy exports (kept for migration, to be removed in future) ───

/**
 * @deprecated No longer needed — skills are copies, not symlinks. Kept for migration.
 */
export function cleanupGitignore(gitignorePath: string): {
  cleaned: boolean;
  duplicatesRemoved: number;
  entriesAfter: number;
} {
  if (!existsSync(gitignorePath)) {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
  }

  const PANOPTICON_HEADER = '# Panopticon-managed symlinks (not committed)';
  let content: string;
  try {
    content = readFileSync(gitignorePath, 'utf-8');
  } catch {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
  }

  // If no Panopticon section, nothing to clean
  if (!content.includes(PANOPTICON_HEADER)) {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
  }

  // Remove the entire Panopticon section (skills are copies now, not symlinks)
  const lines = content.split('\n');
  const newLines: string[] = [];
  let inPanopticonSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === PANOPTICON_HEADER) {
      inPanopticonSection = true;
      continue;
    }
    if (inPanopticonSection) {
      if (trimmed.startsWith('#') && trimmed !== '') {
        inPanopticonSection = false;
        newLines.push(line);
      } else if (trimmed === '') {
        // Skip blank lines in Panopticon section
        continue;
      }
      // Skip entries in Panopticon section
      continue;
    }
    newLines.push(line);
  }

  // Write cleaned file
  try {
    writeFileSync(gitignorePath, newLines.join('\n'), 'utf-8');
    return { cleaned: true, duplicatesRemoved: 0, entriesAfter: 0 };
  } catch {
    return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
  }
}

/**
 * @deprecated No longer needed — skills are copies, not symlinks. Kept for migration.
 */
export function cleanupWorkspaceGitignore(workspacePath: string): {
  cleaned: boolean;
  duplicatesRemoved: number;
  entriesAfter: number;
} {
  const gitignorePath = join(workspacePath, '.claude', 'skills', '.gitignore');
  return cleanupGitignore(gitignorePath);
}

/**
 * Merge project-local skills from .pan/skills/ into a workspace's .claude/skills/.
 *
 * Precedence (highest wins):
 * 1. .claude/skills/<name>/ already in workspace (user-owned or project template) → skip
 * 2. .pan/skills/<name>/ in project repo → copy into workspace .claude/skills/
 * 3. Global cache (handled by mergeSkillsIntoWorkspace) → baseline
 *
 * This should be called AFTER mergeSkillsIntoWorkspace so that project-local skills
 * can override global cache skills (but never overwrite user-owned content).
 */
export function mergePanSkillsIntoWorkspace(projectPath: string, workspacePath: string): MergeResult {
  const result: MergeResult = { added: [], updated: [], skipped: [], overlayed: [] };
  const panSkillsDir = join(projectPath, '.pan', 'skills');
  if (!existsSync(panSkillsDir)) return result;

  const claudeSkillsDir = join(workspacePath, '.claude', 'skills');
  const manifestPath = join(workspacePath, '.claude', '.panopticon-manifest.json');
  const manifest = Effect.runSync(
    readManifest(manifestPath).pipe(Effect.orElseSucceed(createEmptyManifest)),
  );

  const skillDirs = readdirSync(panSkillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  for (const skillName of skillDirs) {
    const sourceSkillDir = join(panSkillsDir, skillName);
    const targetSkillDir = join(claudeSkillsDir, skillName);

    // Rule #1: if target already exists (user-owned or project-template), never overwrite
    if (existsSync(targetSkillDir)) {
      result.skipped.push(`skills/${skillName} (already exists in .claude/skills/)`);
      continue;
    }

    // Rule #2: copy from .pan/skills/<name>/ to workspace .claude/skills/<name>/
    const files = Effect.runSync(collectSourceFiles(sourceSkillDir, ''));
    mkdirSync(targetSkillDir, { recursive: true });
    let anyAdded = false;
    for (const file of files) {
      const targetPath = join(targetSkillDir, file.relativePath);
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(file.absolutePath, targetPath);
      const hash = Effect.runSync(hashFile(targetPath));
      setManifestEntry(manifest, `skills/${skillName}/${file.relativePath}`, hash, 'pan-skills');
      result.added.push(`skills/${skillName}/${file.relativePath}`);
      anyAdded = true;
    }
    if (anyAdded) {
      result.overlayed.push(skillName);
    }
  }

  Effect.runSync(writeManifest(manifestPath, manifest));
  return result;
}
