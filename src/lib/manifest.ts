import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { join, relative } from 'path';
import { Effect } from 'effect';
import { FsError } from './errors.js';

/**
 * Manifest entry for a single distributed file.
 */
export interface ManifestEntry {
  hash: string;           // sha256:<hex>
  source: string;         // "panopticon" | "project-template" | custom
  installed_at: string;   // ISO 8601 timestamp
}

/**
 * The manifest schema: tracks what Panopticon placed at a target location.
 */
export interface Manifest {
  version: 1;
  managed_by: 'panopticon';
  installed: Record<string, ManifestEntry>;
}

/**
 * Result of comparing a file against the manifest.
 */
export type FileStatus =
  | { action: 'new' }                          // File doesn't exist at target — safe to copy
  | { action: 'update'; currentHash: string }   // File exists, hash matches manifest — we placed it, user didn't modify
  | { action: 'modified'; currentHash: string; manifestHash: string }  // File exists, hash differs from manifest — user modified
  | { action: 'user-owned' }                    // File exists but NOT in manifest — user placed it, never touch
  ;

/**
 * Compute SHA-256 hash of a file, prefixed with "sha256:".
 */
export function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  const hex = createHash('sha256').update(content).digest('hex');
  return `sha256:${hex}`;
}

/**
 * Create an empty manifest.
 */
export function createEmptyManifest(): Manifest {
  return {
    version: 1,
    managed_by: 'panopticon',
    installed: {},
  };
}

/**
 * Read a manifest from disk. Returns empty manifest if file doesn't exist or is invalid.
 */
export function readManifest(manifestPath: string): Manifest {
  if (!existsSync(manifestPath)) {
    return createEmptyManifest();
  }

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (raw.version === 1 && raw.managed_by === 'panopticon' && typeof raw.installed === 'object') {
      return raw as Manifest;
    }
    return createEmptyManifest();
  } catch {
    return createEmptyManifest();
  }
}

/**
 * Write a manifest to disk (creates parent directories if needed).
 */
export function writeManifest(manifestPath: string, manifest: Manifest): void {
  mkdirSync(join(manifestPath, '..'), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/**
 * Add or update an entry in a manifest.
 */
export function setManifestEntry(
  manifest: Manifest,
  relativePath: string,
  hash: string,
  source: string,
): void {
  manifest.installed[relativePath] = {
    hash,
    source,
    installed_at: new Date().toISOString(),
  };
}

/**
 * Remove an entry from a manifest.
 */
export function removeManifestEntry(manifest: Manifest, relativePath: string): void {
  delete manifest.installed[relativePath];
}

/**
 * Compare a file on disk against the manifest to determine what action to take.
 *
 * @param targetFile - Absolute path to the file at the target location
 * @param relativePath - Relative path used as key in the manifest (e.g., "skills/beads/SKILL.md")
 * @param manifest - The manifest to compare against
 */
export function compareFileToManifest(
  targetFile: string,
  relativePath: string,
  manifest: Manifest,
): FileStatus {
  if (!existsSync(targetFile)) {
    return { action: 'new' };
  }

  const entry = manifest.installed[relativePath];
  if (!entry) {
    return { action: 'user-owned' };
  }

  const currentHash = hashFile(targetFile);
  if (currentHash === entry.hash) {
    return { action: 'update', currentHash };
  }

  return { action: 'modified', currentHash, manifestHash: entry.hash };
}

/**
 * Walk a source directory and collect all files with their relative paths.
 * Used to build the list of files to distribute.
 *
 * @param sourceDir - Root directory to walk
 * @param prefix - Prefix for relative paths (e.g., "skills/" or "agents/")
 * @returns Array of { absolutePath, relativePath } for each file found
 */
export function collectSourceFiles(
  sourceDir: string,
  prefix: string,
): Array<{ absolutePath: string; relativePath: string }> {
  const results: Array<{ absolutePath: string; relativePath: string }> = [];

  if (!existsSync(sourceDir)) {
    return results;
  }

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const rel = relative(sourceDir, fullPath);
        results.push({
          absolutePath: fullPath,
          relativePath: `${prefix}${rel}`,
        });
      }
    }
  }

  walk(sourceDir);
  return results;
}

/**
 * Build a manifest from a directory by hashing all files.
 * Useful for generating the initial cache manifest.
 *
 * @param baseDir - The directory to scan (e.g., ~/.panopticon/)
 * @param categories - Which subdirectories to include (e.g., ["skills", "agents", "rules"])
 * @param source - The source label for all entries (e.g., "panopticon")
 */
export function buildManifestFromDirectory(
  baseDir: string,
  categories: string[],
  source: string,
): Manifest {
  const manifest = createEmptyManifest();

  for (const category of categories) {
    const categoryDir = join(baseDir, category);
    const files = collectSourceFiles(categoryDir, `${category}/`);
    for (const file of files) {
      const hash = hashFile(file.absolutePath);
      setManifestEntry(manifest, file.relativePath, hash, source);
    }
  }

  return manifest;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of {@link hashFile}. */
export const hashFileEffect = (filePath: string): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: async () => {
      const content = await readFile(filePath);
      const hex = createHash('sha256').update(content).digest('hex');
      return `sha256:${hex}`;
    },
    catch: (cause) => new FsError({ path: filePath, operation: 'hashFile', cause }),
  });

/** Effect variant of {@link readManifest}. Returns an empty manifest on any read/parse failure. */
export const readManifestEffect = (manifestPath: string): Effect.Effect<Manifest, never> =>
  Effect.tryPromise({
    try: () => readFile(manifestPath, 'utf-8'),
    catch: () => null,
  }).pipe(
    Effect.match({
      onFailure: () => createEmptyManifest(),
      onSuccess: (raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.version === 1 && parsed.managed_by === 'panopticon' && typeof parsed.installed === 'object') {
            return parsed as Manifest;
          }
        } catch { /* fall through */ }
        return createEmptyManifest();
      },
    }),
  );

/** Effect variant of {@link writeManifest}. */
export const writeManifestEffect = (manifestPath: string, manifest: Manifest): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(join(manifestPath, '..'), { recursive: true });
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    },
    catch: (cause) => new FsError({ path: manifestPath, operation: 'writeManifest', cause }),
  });

/** Effect variant of {@link collectSourceFiles}. */
export const collectSourceFilesEffect = (
  sourceDir: string,
  prefix: string,
): Effect.Effect<Array<{ absolutePath: string; relativePath: string }>, FsError> =>
  Effect.tryPromise({
    try: async (): Promise<Array<{ absolutePath: string; relativePath: string }>> => {
      const results: Array<{ absolutePath: string; relativePath: string }> = [];
      if (!existsSync(sourceDir)) return results;

      async function walk(dir: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            const rel = relative(sourceDir, fullPath);
            results.push({ absolutePath: fullPath, relativePath: `${prefix}${rel}` });
          }
        }
      }

      await walk(sourceDir);
      return results;
    },
    catch: (cause) => new FsError({ path: sourceDir, operation: 'collectSourceFiles', cause }),
  });

