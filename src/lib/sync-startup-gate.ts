import { createHash, type Hash } from 'crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { OVERDECK_HOME, SYNC_SOURCES, isDevMode } from './paths.js';
import { listProjectsSync } from './projects.js';

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

  // mirrorProjectSkillsSync depends on the cwd.
  hash.update(process.cwd());

  for (const [key, dir] of Object.entries(SYNC_SOURCES)) {
    if (!existsSync(dir)) {
      throw new Error(`missing sync input: ${key} at ${dir}`);
    }
    updateHashFromDirectory(hash, dir);
  }

  const globalMd = join(OVERDECK_HOME, 'context', 'global.md');
  if (!existsSync(globalMd)) {
    throw new Error('missing global context layer');
  }
  updateHashFromFile(hash, globalMd);

  for (const { config } of listProjectsSync()) {
    const projectMd = join(config.path, '.pan', 'context', 'project.md');
    if (existsSync(projectMd)) {
      updateHashFromFile(hash, projectMd);
    }
  }

  return hash.digest('hex');
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
