import { createHash } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'fs';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { Effect } from 'effect';
import { FsError } from './errors.js';

/**
 * Manifest entry for a single distributed file.
 */
export interface ManifestEntry {
  hash: string;           // sha256:<hex>
  source: string;         // "overdeck" | "project-template" | custom
  installed_at: string;   // ISO 8601 timestamp
}

/**
 * The manifest schema: tracks what Overdeck placed at a target location.
 */
export interface Manifest {
  version: 1;
  managed_by: 'overdeck';
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
export function hashFileSync(filePath: string): string {
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
    managed_by: 'overdeck',
    installed: {},
  };
}

/**
 * Read a manifest from disk. Returns empty manifest if file doesn't exist or is invalid.
 */
export function readManifestSync(manifestPath: string): Manifest {
  if (!existsSync(manifestPath)) {
    return createEmptyManifest();
  }

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (raw.version === 1 && raw.managed_by === 'overdeck' && typeof raw.installed === 'object') {
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
export function writeManifestSync(manifestPath: string, manifest: Manifest): void {
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

export interface PruneResult {
  pruned: string[];
  keptModified: string[];
}

/**
 * Remove stale Overdeck-managed files while preserving user modifications.
 *
 * Entries are stale when their manifest path is absent from the current bundled
 * source set. Modified files lose Overdeck ownership in the manifest but remain
 * on disk, so later syncs treat them as user-owned.
 */
export function pruneStaleManifestEntriesSync(
  targetBase: string,
  manifest: Manifest,
  currentSourceRelPaths: ReadonlySet<string>,
  opts?: { prefixes?: string[] },
): PruneResult {
  const result: PruneResult = { pruned: [], keptModified: [] };
  const absoluteBase = resolve(targetBase);
  let canonicalBase = absoluteBase;
  let baseIsDirectory = false;
  let baseMissing = false;

  try {
    canonicalBase = realpathSync(absoluteBase);
    baseIsDirectory = lstatSync(canonicalBase).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      baseIsDirectory = lstatSync(absoluteBase).isDirectory();
    } catch (baseError) {
      if ((baseError as NodeJS.ErrnoException).code !== 'ENOENT') throw baseError;
      baseMissing = true;
    }
  }

  const releaseOwnership = (relativePath: string): void => {
    removeManifestEntry(manifest, relativePath);
    result.keptModified.push(relativePath);
  };

  const isWithinBase = (candidate: string, allowBase: boolean): boolean => {
    const fromBase = relative(canonicalBase, candidate);
    if (fromBase === '') return allowBase;
    return fromBase !== '..' && !fromBase.startsWith(`..${sep}`) && !isAbsolute(fromBase);
  };

  for (const [relativePath, entry] of Object.entries(manifest.installed)) {
    if (entry.source !== 'overdeck') continue;
    if (currentSourceRelPaths.has(relativePath)) continue;

    const pathSegments = relativePath.split(/[\\/]/);
    if (
      relativePath.length === 0
      || relativePath.includes('\0')
      || isAbsolute(relativePath)
      || pathSegments.includes('..')
    ) {
      releaseOwnership(relativePath);
      continue;
    }
    if (
      opts?.prefixes
      && !opts.prefixes.some((prefix) => relativePath.startsWith(prefix))
    ) continue;
    if (baseMissing) {
      removeManifestEntry(manifest, relativePath);
      result.pruned.push(relativePath);
      continue;
    }

    const targetFile = resolve(canonicalBase, relativePath);
    if (!isWithinBase(targetFile, false) || !baseIsDirectory) {
      releaseOwnership(relativePath);
      continue;
    }

    const targetParent = dirname(targetFile);
    const parentSegments = relative(canonicalBase, targetParent).split(sep).filter(Boolean);
    let currentParent = canonicalBase;
    let parentMissing = false;
    let unsafeParent = false;

    for (const segment of parentSegments) {
      currentParent = join(currentParent, segment);
      try {
        const status = lstatSync(currentParent);
        if (status.isSymbolicLink() || !status.isDirectory()) {
          unsafeParent = true;
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        parentMissing = true;
        break;
      }
    }

    if (unsafeParent) {
      releaseOwnership(relativePath);
      continue;
    }
    if (parentMissing) {
      removeManifestEntry(manifest, relativePath);
      result.pruned.push(relativePath);
      continue;
    }

    const canonicalParent = realpathSync(targetParent);
    if (!isWithinBase(canonicalParent, true)) {
      releaseOwnership(relativePath);
      continue;
    }
    const canonicalTarget = join(canonicalParent, basename(targetFile));

    let targetStatus: ReturnType<typeof lstatSync>;
    try {
      targetStatus = lstatSync(canonicalTarget);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      removeManifestEntry(manifest, relativePath);
      result.pruned.push(relativePath);
      continue;
    }

    if (!targetStatus.isFile() || hashFileSync(canonicalTarget) !== entry.hash) {
      releaseOwnership(relativePath);
      continue;
    }

    unlinkSync(canonicalTarget);
    removeManifestEntry(manifest, relativePath);
    result.pruned.push(relativePath);

    let currentDir = canonicalParent;
    while (currentDir !== canonicalBase && isWithinBase(currentDir, false)) {
      const status = lstatSync(currentDir);
      if (status.isSymbolicLink() || !status.isDirectory() || readdirSync(currentDir).length > 0) break;
      rmdirSync(currentDir);
      currentDir = dirname(currentDir);
    }
  }

  return result;
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

  const currentHash = hashFileSync(targetFile);
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
export function collectSourceFilesSync(
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
 * @param baseDir - The directory to scan (e.g., ~/.overdeck/)
 * @param categories - Which subdirectories to include (e.g., ["skills", "agents", "rules"])
 * @param source - The source label for all entries (e.g., "overdeck")
 */
export function buildManifestFromDirectory(
  baseDir: string,
  categories: string[],
  source: string,
): Manifest {
  const manifest = createEmptyManifest();

  for (const category of categories) {
    const categoryDir = join(baseDir, category);
    const files = collectSourceFilesSync(categoryDir, `${category}/`);
    for (const file of files) {
      const hash = hashFileSync(file.absolutePath);
      setManifestEntry(manifest, file.relativePath, hash, source);
    }
  }

  return manifest;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Effect variant of {@link hashFileSync}. */
export const hashFile = (filePath: string): Effect.Effect<string, FsError> =>
  Effect.tryPromise({
    try: async () => {
      const content = await readFile(filePath);
      const hex = createHash('sha256').update(content).digest('hex');
      return `sha256:${hex}`;
    },
    catch: (cause) => new FsError({ path: filePath, operation: 'hashFile', cause }),
  });

/** Effect variant of {@link readManifestSync}. Returns an empty manifest on any read/parse failure. */
export const readManifest = (manifestPath: string): Effect.Effect<Manifest, never> =>
  Effect.tryPromise({
    try: () => readFile(manifestPath, 'utf-8'),
    catch: () => null,
  }).pipe(
    Effect.match({
      onFailure: () => createEmptyManifest(),
      onSuccess: (raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.version === 1 && parsed.managed_by === 'overdeck' && typeof parsed.installed === 'object') {
            return parsed as Manifest;
          }
        } catch { /* fall through */ }
        return createEmptyManifest();
      },
    }),
  );

/** Effect variant of {@link writeManifestSync}. */
export const writeManifest = (manifestPath: string, manifest: Manifest): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(join(manifestPath, '..'), { recursive: true });
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    },
    catch: (cause) => new FsError({ path: manifestPath, operation: 'writeManifest', cause }),
  });

/** Effect variant of {@link collectSourceFilesSync}. */
export const collectSourceFiles = (
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
