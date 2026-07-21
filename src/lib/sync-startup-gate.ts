import { createHash, type Hash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { OVERDECK_HOME, SYNC_SOURCES, isDevMode } from './paths.js';
import { listProjectsSync } from './projects.js';
import { resolveProjectContextFile } from './context-layers/layers.js';

/** Persisted manifest for the startup sync skip-when-unchanged gate. */
export interface SyncManifest {
  hash: string;
  generatedAt: string;
}

/**
 * Compute a deterministic hash of every input that can change the output of
 * `pan sync`. Missing a sync input is treated as an error by the caller so
 * that the conservative fallback is always a full sync.
 */
function computeSyncInputHash(): string {
  const hash = createHash('sha256');

  // Dev mode affects which skills are copied from sync-sources/dev-skills.
  hash.update(String(isDevMode()));

  // mirrorProjectSkillsSync depends on the cwd, its top-level skills/ tree, and registered project-local skills.
  hash.update(process.cwd());
  const cwdSkillsRoot = resolveTopLevelSkillsRoot(process.cwd());
  if (cwdSkillsRoot) {
    updateHashFromDirectory(hash, join(cwdSkillsRoot, 'skills'));
  }

  for (const [key, sourcePath] of Object.entries(SYNC_SOURCES)) {
    if (!existsSync(sourcePath)) {
      throw new Error(`missing sync input: ${key} at ${sourcePath}`);
    }
    // Most sync sources are directories, but some (plugins.json) are single files.
    if (statSync(sourcePath).isDirectory()) {
      updateHashFromDirectory(hash, sourcePath);
    } else {
      updateHashFromFile(hash, sourcePath);
    }
  }

  const globalMd = join(OVERDECK_HOME, 'context', 'global.md');
  if (!existsSync(globalMd)) {
    throw new Error('missing global context layer');
  }
  updateHashFromFile(hash, globalMd);

  for (const { config } of listProjectsSync()) {
    const projectMd = resolveProjectContextFile(config.path);
    if (existsSync(projectMd)) {
      updateHashFromFile(hash, projectMd);
    }

    const projectSkills = join(config.path, '.pan', 'skills');
    if (existsSync(projectSkills)) {
      updateHashFromDirectory(hash, projectSkills);
    }
  }

  return hash.digest('hex');
}

function resolveTopLevelSkillsRoot(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'skills');
    if (containsSkillDefinitions(candidate)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function containsSkillDefinitions(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(dir, entry.name, 'SKILL.md')) || existsSync(join(dir, entry.name, 'skill.md'))) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function updateHashFromDirectory(hash: Hash, dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      updateHashFromDirectory(hash, entryPath);
    } else if (entry.isFile()) {
      updateHashFromFile(hash, entryPath);
    }
  }
}

function updateHashFromFile(hash: Hash, filePath: string): void {
  hash.update(filePath);
  hash.update(readFileSync(filePath));
}

/**
 * Decide whether the startup sync has work to do. Returns `{ needed: false }`
 * only when the persisted manifest at ~/.overdeck/.sync-manifest.json matches
 * the current input hash. Any uncertainty (missing input, unreadable manifest,
 * hash computation error) falls back to `{ needed: true }`.
 */
export function isStartupSyncNeededSync(): { needed: boolean; reason: string } {
  const manifestPath = join(OVERDECK_HOME, '.sync-manifest.json');
  try {
    const currentHash = computeSyncInputHash();
    if (existsSync(manifestPath)) {
      const manifest: SyncManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.hash === currentHash) {
        return { needed: false, reason: 'inputs unchanged' };
      }
    }
    return { needed: true, reason: 'inputs changed or no manifest' };
  } catch (err: unknown) {
    return { needed: true, reason: `hash computation failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Write the current sync input hash to ~/.overdeck/.sync-manifest.json.
 * Call after a full sync so the next startup skip gate can succeed.
 */
export function writeSyncManifestSync(): void {
  const manifestPath = join(OVERDECK_HOME, '.sync-manifest.json');
  const hash = computeSyncInputHash();
  writeFileSync(
    manifestPath,
    JSON.stringify({ hash, generatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf-8',
  );
}
