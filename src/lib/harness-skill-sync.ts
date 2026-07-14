import { copyFileSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { AGENT_SKILLS_DIR, SKILLS_DIR } from './paths.js';
import {
  collectSourceFilesSync,
  compareFileToManifest,
  hashFileSync,
  readManifestSync,
  setManifestEntry,
  writeManifestSync,
} from './manifest.js';
import type { SyncItem, SyncOptions, SyncResult } from './sync.js';

/** Every harness whose native skill discovery is supplied by `pan sync`. */
export const SKILL_SYNC_HARNESSES = ['claude-code', 'codex', 'pi', 'ohmypi'] as const;

/** Plan the shared Agent Skills half of the harness fan-out. */
export function planAgentSkillsSync(
  targetSkillsDir: string = AGENT_SKILLS_DIR,
  sourceSkillsDir: string = SKILLS_DIR,
): SyncItem[] {
  const manifest = readManifestSync(join(dirname(targetSkillsDir), '.overdeck-manifest.json'));
  return collectSourceFilesSync(sourceSkillsDir, '').map((file) => {
    const targetPath = join(targetSkillsDir, file.relativePath);
    const status = compareFileToManifest(targetPath, `skills/${file.relativePath}`, manifest);
    const syncStatus: SyncItem['status'] = status.action === 'new'
      ? 'new'
      : status.action === 'update'
        ? 'symlink'
        : status.action === 'modified'
          ? 'conflict'
          : 'exists';
    return { name: file.relativePath, sourcePath: file.absolutePath, targetPath, status: syncStatus };
  });
}

/** Copy complete skill bundles into the standard directory shared by Codex, Pi, and Oh My Pi. */
export function executeAgentSkillsSync(
  options: SyncOptions = {},
  targetSkillsDir: string = AGENT_SKILLS_DIR,
  sourceSkillsDir: string = SKILLS_DIR,
): SyncResult {
  const result: SyncResult = {
    created: [], updated: [], adopted: [], skipped: [], conflicts: [], diffs: [],
  };
  const manifestPath = join(dirname(targetSkillsDir), '.overdeck-manifest.json');
  const manifest = readManifestSync(manifestPath);

  for (const file of collectSourceFilesSync(sourceSkillsDir, '')) {
    const targetFile = join(targetSkillsDir, file.relativePath);
    const manifestKey = `skills/${file.relativePath}`;
    const status = compareFileToManifest(targetFile, manifestKey, manifest);

    if (status.action === 'new' || status.action === 'update') {
      mkdirSync(dirname(targetFile), { recursive: true });
      copyFileSync(file.absolutePath, targetFile);
      setManifestEntry(manifest, manifestKey, hashFileSync(targetFile), 'overdeck');
      result[status.action === 'new' ? 'created' : 'updated'].push(file.relativePath);
    } else if (status.action === 'modified') {
      if (options.diff) {
        result.diffs.push({
          path: file.relativePath,
          sourceContent: readFileSync(file.absolutePath, 'utf-8'),
          targetContent: readFileSync(targetFile, 'utf-8'),
        });
      }
      if (options.force) {
        copyFileSync(file.absolutePath, targetFile);
        setManifestEntry(manifest, manifestKey, hashFileSync(targetFile), 'overdeck');
        result.updated.push(file.relativePath);
      } else {
        result.conflicts.push(file.relativePath);
      }
    } else {
      result.skipped.push(file.relativePath);
    }
  }

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeManifestSync(manifestPath, manifest);
  return result;
}
