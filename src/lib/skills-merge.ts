import { Effect } from 'effect';
import { FsError } from './errors.js';

/**
 * Compatibility surface for the retired workspace harness-file distributor.
 *
 * Overdeck no longer copies skills, agents, rules, templates, manifests, or
 * gitignore entries into a repository's `.claude` tree. Existing project files
 * remain native and untouched; managed launches receive private assets from
 * `~/.overdeck/harnesses` instead.
 */

export interface MergeResult {
  added: string[];
  updated: string[];
  skipped: string[];
  overlayed: string[];
  pruned: string[];
  keptModified: string[];
}

function emptyMergeResult(): MergeResult {
  return { added: [], updated: [], skipped: [], overlayed: [], pruned: [], keptModified: [] };
}

export function mergeSkillsIntoWorkspaceSync(workspacePath: string): MergeResult {
  void workspacePath;
  return emptyMergeResult();
}

export function applyProjectTemplateOverlaySync(
  workspacePath: string,
  templateDir: string,
  templates?: Array<{ source: string; target: string }>,
): string[] {
  void workspacePath;
  void templateDir;
  void templates;
  return [];
}

export function cleanupGitignoreSync(gitignorePath: string): {
  cleaned: boolean;
  duplicatesRemoved: number;
  entriesAfter: number;
} {
  void gitignorePath;
  return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
}

export function cleanupWorkspaceGitignoreSync(workspacePath: string): ReturnType<typeof cleanupGitignoreSync> {
  void workspacePath;
  return { cleaned: false, duplicatesRemoved: 0, entriesAfter: 0 };
}

export function mergePanSkillsIntoWorkspaceSync(projectPath: string, workspacePath: string): MergeResult {
  void projectPath;
  void workspacePath;
  return emptyMergeResult();
}

export const mergeSkillsIntoWorkspace = (workspacePath: string): Effect.Effect<MergeResult, FsError> =>
  Effect.succeed(mergeSkillsIntoWorkspaceSync(workspacePath));

export const applyProjectTemplateOverlay = (
  ...args: Parameters<typeof applyProjectTemplateOverlaySync>
): Effect.Effect<ReturnType<typeof applyProjectTemplateOverlaySync>, FsError> =>
  Effect.succeed(applyProjectTemplateOverlaySync(...args));

export const cleanupGitignore = (gitignorePath: string): Effect.Effect<ReturnType<typeof cleanupGitignoreSync>, FsError> =>
  Effect.succeed(cleanupGitignoreSync(gitignorePath));

export const cleanupWorkspaceGitignore = (
  workspacePath: string,
): Effect.Effect<ReturnType<typeof cleanupWorkspaceGitignoreSync>, FsError> =>
  Effect.succeed(cleanupWorkspaceGitignoreSync(workspacePath));

export const mergePanSkillsIntoWorkspace = (
  projectPath: string,
  workspacePath: string,
): Effect.Effect<MergeResult, FsError> =>
  Effect.succeed(mergePanSkillsIntoWorkspaceSync(projectPath, workspacePath));
