import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { PanMigrationResult } from './types.js';

/**
 * Migrate existing .overdeck/<subdir> directories to .pan/<subdir> within a project.
 *
 * Safety rules:
 * - If old path exists and new path does NOT exist → move old to new.
 * - If both old and new exist → log warning and skip (never overwrite silently).
 * - If neither exists → nothing to do.
 * - Only migrates the specific runtime subdirs (events, prompts, legacy output).
 *   .pan/skills/ is not migrated here since it may not have existed before.
 */
export function migrateOverdeckToPanSync(projectPath: string): PanMigrationResult {
  const result: PanMigrationResult = { migrated: [], skipped: [], errors: [] };

  // Map legacy .overdeck/<subdir> paths to new .pan/<subdir> paths.
  const legacyMappings: Array<{ old: string; new: string }> = [
    { old: '.overdeck/events', new: '.pan/events' },
    { old: '.overdeck/triage', new: '.pan/review' },
    { old: '.overdeck/health', new: '.pan/review' },
    { old: '.overdeck/convoy-output', new: '.pan/review' },
    { old: '.overdeck/prompts', new: '.pan/prompts' },
  ];

  for (const { old: oldRelPath, new: newRelPath } of legacyMappings) {
    const oldPath = join(projectPath, oldRelPath);
    const newPath = join(projectPath, newRelPath);

    if (!existsSync(oldPath)) continue;

    if (existsSync(newPath)) {
      const msg = `Migration skipped: both ${oldRelPath} and ${newRelPath} exist in ${projectPath} — remove one manually`;
      console.warn(`[overdeck] ${msg}`);
      result.skipped.push(oldRelPath);
      continue;
    }

    try {
      // Ensure parent directory exists
      const parentDir = dirname(newPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      renameSync(oldPath, newPath);
      result.migrated.push(`${oldRelPath} → ${newRelPath}`);
    } catch (err: any) {
      result.errors.push(`${oldRelPath}: ${err.message}`);
    }
  }

  // Clean up empty .overdeck/ dir if nothing remains
  const overdeckDir = join(projectPath, '.overdeck');
  if (existsSync(overdeckDir)) {
    try {
      const remaining = readdirSync(overdeckDir);
      if (remaining.length === 0) {
        rmdirSync(overdeckDir);
        result.migrated.push('.overdeck/ (empty dir removed)');
      }
    } catch {
      // Non-fatal — dir may have been removed already
    }
  }

  return result;
}

/**
 * Copy Overdeck global configuration into a workspace so that agents testing
 * Overdeck itself have the same projects, model assignments, and hooks.
 *
 * Copies:
 *   - ~/.overdeck/config.yaml      → <workspace>/.overdeck/config.yaml
 *   - ~/.overdeck/projects.yaml    → <workspace>/.overdeck/projects.yaml
 *   - ~/.overdeck/settings.json    → <workspace>/.overdeck/settings.json
 * Harness-native files are intentionally excluded. Managed launches receive
 * settings, hooks, MCP, skills, and context through Overdeck-private homes.
 */
export function copyOverdeckSettingsToWorkspaceSync(workspacePath: string): { copied: string[]; errors: string[] } {
  const result = { copied: [] as string[], errors: [] as string[] };
  const overdeckDir = join(workspacePath, '.overdeck');

  mkdirSync(overdeckDir, { recursive: true });

  const filesToCopy = [
    { source: join(homedir(), '.overdeck', 'config.yaml'), target: join(overdeckDir, 'config.yaml') },
    { source: join(homedir(), '.overdeck', 'projects.yaml'), target: join(overdeckDir, 'projects.yaml') },
    { source: join(homedir(), '.overdeck', 'settings.json'), target: join(overdeckDir, 'settings.json') },
  ];

  for (const { source, target } of filesToCopy) {
    if (!existsSync(source)) continue;
    try {
      copyFileSync(source, target);
      result.copied.push(target);
    } catch (err: any) {
      result.errors.push(`${source}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Ensure runtime-only Overdeck and Claude Code sync paths are excluded from git tracking
 * in the given project root's .gitignore. .pan/skills/ is intentionally NOT excluded
 * since project-specific skills should be committed.
 */
export function ensurePanGitignoreSync(projectPath: string): void {
  const gitignorePath = join(projectPath, '.gitignore');
  const requiredEntries = ['.pan/events/', '.pan/review/', '.pan/prompts/', '.pan/test/'];

  let content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  const lines = content.split('\n');

  const missing = requiredEntries.filter(entry => !lines.some(l => l.trim() === entry));
  if (missing.length === 0) return;

  // Append missing entries with a section header if we're adding for the first time
  if (!content.endsWith('\n') && content.length > 0) {
    content += '\n';
  }
  if (!lines.some(l => l.includes('.pan/'))) {
    content += '\n# Overdeck runtime artifacts (ephemeral, not tracked)\n';
  }
  content += missing.join('\n') + '\n';

  writeFileSync(gitignorePath, content, 'utf-8');
}
