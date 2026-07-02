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
 *   - ~/.claude/settings.json hooks  → <workspace>/.claude/settings.json (merged)
 *
 * Safe to call multiple times — merges rather than overwrites.
 */
export function copyOverdeckSettingsToWorkspaceSync(workspacePath: string): { copied: string[]; errors: string[] } {
  const result = { copied: [] as string[], errors: [] as string[] };
  const overdeckDir = join(workspacePath, '.overdeck');
  const claudeDir = join(workspacePath, '.claude');

  mkdirSync(overdeckDir, { recursive: true });
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  const filesToCopy = [
    { source: join(homedir(), '.overdeck', 'config.yaml'), target: join(overdeckDir, 'config.yaml') },
    { source: join(homedir(), '.overdeck', 'projects.yaml'), target: join(overdeckDir, 'projects.yaml') },
    { source: join(homedir(), '.overdeck', 'settings.json'), target: join(overdeckDir, 'settings.json') },
    { source: join(homedir(), '.claude', 'mcp.json'), target: join(claudeDir, 'mcp.json') },
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

  // Merge global ~/.claude/settings.json into workspace .claude/settings.json
  const globalSettingsPath = join(homedir(), '.claude', 'settings.json');
  const workspaceSettingsPath = join(claudeDir, 'settings.json');

  if (existsSync(globalSettingsPath)) {
    try {
      const globalSettings = JSON.parse(readFileSync(globalSettingsPath, 'utf-8'));
      let workspaceSettings: Record<string, unknown> = {};
      if (existsSync(workspaceSettingsPath)) {
        try {
          workspaceSettings = JSON.parse(readFileSync(workspaceSettingsPath, 'utf-8'));
        } catch {
          // Unparseable — start fresh
          workspaceSettings = {};
        }
      }

      // Deep-merge hooks so workspace settings (e.g. caveman) are preserved
      const mergedHooks: Record<string, unknown> = {};
      if (globalSettings.hooks) {
        Object.assign(mergedHooks, globalSettings.hooks);
      }
      if (workspaceSettings.hooks) {
        for (const [key, value] of Object.entries(workspaceSettings.hooks as Record<string, unknown>)) {
          if (Array.isArray(value) && Array.isArray(mergedHooks[key])) {
            mergedHooks[key] = [...(mergedHooks[key] as unknown[]), ...value];
          } else {
            mergedHooks[key] = value;
          }
        }
      }

      // Validate hook paths — remove hooks that reference non-existent absolute paths
      // to prevent Claude Code from hanging when executing broken hooks.
      function isBrokenHookCommand(command: string): boolean {
        const tokens = command.split(/\s+/);
        for (let token of tokens) {
          token = token.replace(/^["'`]+|["'`]+$/g, '').replace(/[;|&<>]+$/, '');
          if (token.startsWith('/')) {
            try {
              if (!existsSync(token)) return true;
            } catch {
              return true;
            }
          }
        }
        return false;
      }

      for (const [category, hookList] of Object.entries(mergedHooks)) {
        if (!Array.isArray(hookList)) continue;
        const validHooks = (hookList as Array<{ command?: string }>).filter((hook) => {
          if (typeof hook.command !== 'string') return true;
          if (!hook.command.trim()) return true;
          const hasAbsolutePath = hook.command.split(/\s+/).some((t) => {
            const clean = t.replace(/^["'`]+|["'`]+$/g, '').replace(/[;|&<>]+$/, '');
            return clean.startsWith('/');
          });
          if (!hasAbsolutePath) return true; // relative / shell-only, skip validation
          if (isBrokenHookCommand(hook.command)) {
            result.errors.push(`Removed broken hook from workspace settings: ${category} → ${hook.command}`);
            return false;
          }
          return true;
        });
        if (validHooks.length === 0) {
          delete mergedHooks[category];
        } else {
          mergedHooks[category] = validHooks;
        }
      }

      const merged = { ...globalSettings, ...workspaceSettings };
      if (Object.keys(mergedHooks).length > 0) {
        merged.hooks = mergedHooks;
      } else {
        delete (merged as Record<string, unknown>).hooks;
      }

      writeFileSync(workspaceSettingsPath, JSON.stringify(merged, null, 2), 'utf-8');
      result.copied.push(workspaceSettingsPath);
    } catch (err: any) {
      result.errors.push(`${globalSettingsPath}: ${err.message}`);
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
  const requiredEntries = ['.pan/events/', '.pan/review/', '.pan/prompts/', '.claude/skills/'];

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
