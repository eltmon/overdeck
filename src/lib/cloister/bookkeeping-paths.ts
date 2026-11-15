/**
 * Bookkeeping paths (PAN-4618, PAN-5356): repository paths that hold pipeline
 * bookkeeping — `.pan/**` plan, task and backlog state, and
 * `.overdeck/memory/**` curated facts — and never code.
 *
 * `BOOKKEEPING_PATH_GLOBS` is the one list. CI's `paths-ignore` in
 * `.github/workflows/ci.yml` must equal it (YAML cannot import a constant, so
 * `tests/unit/lib/cloister/bookkeeping-paths.test.ts` fails when the two
 * drift), and the merge-train reconciler uses it to keep a batch whose base
 * moved only by bookkeeping commits.
 *
 * A leaf module: no imports, so any layer can share it.
 */

/** CI `paths-ignore` globs. Each one is `<dir>/**`, which matches every path under `<dir>/`. */
export const BOOKKEEPING_PATH_GLOBS = ['.pan/**', '.overdeck/memory/**'] as const;

const BOOKKEEPING_PREFIXES = BOOKKEEPING_PATH_GLOBS.map((glob) => glob.slice(0, -'**'.length));

/** True when a repo-relative path (as `git log --name-only` prints it) is bookkeeping. */
export function isBookkeepingPath(path: string): boolean {
  return BOOKKEEPING_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Split `git log --name-only --format=` / `git diff --name-only` output into paths. */
export function parseGitPathList(stdout: string): string[] {
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * A move of main from the base a batch was assembled on to the current head.
 * `batchBranch`, when given, is the batch's `uat/**` branch: the move must also
 * not touch any file that branch changes.
 */
export interface BaseMove {
  fromSha: string;
  toSha: string;
  batchBranch?: string;
}

/**
 * The decision behind a base move, from the paths each commit in the move
 * touched and the files the batch changes. A batch may keep its base only when
 * every touched path is bookkeeping and none of them is a file the batch also
 * changes — that overlap is exactly what promote refuses as `stale-base`, and a
 * kept batch it refuses would never be rebuilt.
 */
export function isBookkeepingOnlyMove(touchedPaths: readonly string[], batchFiles: readonly string[] = []): boolean {
  if (!touchedPaths.every(isBookkeepingPath)) return false;
  const batch = new Set(batchFiles);
  return !touchedPaths.some((path) => batch.has(path));
}
