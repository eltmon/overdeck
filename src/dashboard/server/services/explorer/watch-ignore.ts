// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/main/ipc/filesystem/watchers/filesystem-watcher-ignore.ts @ c6b9ac9549b
/**
 * Watcher ignore options (PAN-5183, NFR-5, D-A11). Pure. Ported unchanged
 * except that `platform` is a parameter (default `process.platform`) so
 * every branch is testable. Overdeck adds `topLevelIgnoreRegex` and
 * `buildWatchOptions` for root-level directories such as `workspaces/`.
 */

// Share high-churn exclusions across desktop and runtime watchers, following VS Code's recursive-watch defaults.
export const WATCHER_IGNORE_DIRS: string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
  'target',
  '.venv',
  '__pycache__',
  '.dart_tool',
  '.gradle',
  '.turbo',
];

// FSEvents rejects all exclusions above eight paths; regex filtering covers the remaining names at every depth.
export const MACOS_FSEVENTS_EXCLUSION_PATH_LIMIT = 8;

export type ParcelWatcherIgnoreOptions = {
  ignore?: string[];
  // Parcel forwards this native option despite omitting it from TS declarations (parcel-bundler/watcher#244).
  ignoreGlobs?: string[];
};

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function buildNestedDirectoryRegex(ignoreDirs: readonly string[], platform: NodeJS.Platform): string {
  const alternatives = ignoreDirs.map(escapeRegex).join('|');
  if (platform === 'win32') {
    return `^(?:[^\\\\/]+[\\\\/])*(?:${alternatives})(?:[\\\\/][\\s\\S]*)?$`;
  }
  // Backslash is a valid POSIX filename character.
  return `^(?:[^/]+/)*(?:${alternatives})(?:/[\\s\\S]*)?$`;
}

export function buildParcelWatcherIgnoreOptions(
  ignoreDirs: readonly string[],
  platform: NodeJS.Platform = process.platform,
): ParcelWatcherIgnoreOptions {
  if (ignoreDirs.length === 0) {
    return {};
  }
  if (platform !== 'darwin') {
    // Parcel 2.5.6 leading-** globs cause pathological std::regex lookaheads; one component regex avoids that cost.
    return { ignoreGlobs: [buildNestedDirectoryRegex(ignoreDirs, platform)] };
  }
  const daemonExcludedDirs = ignoreDirs.slice(0, MACOS_FSEVENTS_EXCLUSION_PATH_LIMIT);
  return {
    ignore: [...daemonExcludedDirs],
    // Plain exclusions cover only the root; regex also prunes nested generated directories.
    ignoreGlobs: [buildNestedDirectoryRegex(ignoreDirs, platform)],
  };
}

/** A regex matching `names` (and everything under them) at the root only; null for no names. */
export function topLevelIgnoreRegex(names: readonly string[], platform: NodeJS.Platform = process.platform): string | null {
  if (names.length === 0) return null;
  const alternatives = names.map(escapeRegex).join('|');
  const tail = platform === 'win32' ? '(?:[\\\\/][\\s\\S]*)?' : '(?:/[\\s\\S]*)?';
  return `^(?:${alternatives})${tail}$`;
}

/** Ignore options for one explorer root: the shared nested names plus root-only directories. */
export function buildWatchOptions(
  topLevelDirs: readonly string[],
  platform: NodeJS.Platform = process.platform,
): ParcelWatcherIgnoreOptions {
  const options = buildParcelWatcherIgnoreOptions(WATCHER_IGNORE_DIRS, platform);
  const topLevel = topLevelIgnoreRegex(topLevelDirs, platform);
  if (topLevel === null) return options;
  return { ...options, ignoreGlobs: [...(options.ignoreGlobs ?? []), topLevel] };
}
