/**
 * PAN-5168: on macOS, a `child_process`/Effect spawn of a bare command name
 * that is not on `PATH` makes libuv try `posix_spawn` once per `PATH` entry,
 * and XNU creates a short-lived process for each try — roughly 10 dead
 * processes per failed spawn. Pollers for optional host tools (`docker`,
 * `tmux`, …) ask this module where the tool is before spawning, instead of
 * spawning the bare name and letting the failure happen.
 *
 * D2/D4 semantics: a found path stays cached until `refreshHostTools()` runs
 * or a spawn ENOENT is reported and a fresh lookup no longer finds the tool.
 * A missing tool is cached as `null` and re-looked-up (PATH only, no spawn)
 * once `HOST_TOOL_MISSING_RECHECK_MS` has passed — the back-off. An ENOENT
 * from `noteHostToolSpawnFailed` marks a tool missing only when the fresh
 * lookup it triggers also misses, because Node reports a missing `cwd` as
 * `spawn <cmd> ENOENT` too, and that must not suppress a tool that exists.
 */
import { findExecutableOnPath } from './pan-cli-shim.js';

export type HostToolName = 'docker' | 'tmux' | 'systemctl' | 'journalctl' | 'brew';

export const HOST_TOOL_MISSING_RECHECK_MS = 60_000;

type Finder = (name: HostToolName, pathEnv: string | undefined) => string | null;

export interface HostToolDeps {
  find?: Finder;
  pathEnv?: string;
  now?: () => number;
}

interface Entry {
  path: string | null;
  pathEnv: string | undefined;
  recheckAt: number;
}

const entries = new Map<HostToolName, Entry>();
let testFinder: Finder | null = null;

function lookup(name: HostToolName, pathEnv: string | undefined, deps: HostToolDeps): string | null {
  if (deps.find) return deps.find(name, pathEnv);
  if (testFinder) return testFinder(name, pathEnv);
  if (process.env.OVERDECK_TEST_ASSUME_HOST_TOOLS === '1') return name;
  return findExecutableOnPath(name, pathEnv);
}

/** Cached PATH-only lookup for `name`. Never spawns a process. */
export function resolveHostTool(name: HostToolName, deps: HostToolDeps = {}): string | null {
  const pathEnv = deps.pathEnv ?? process.env.PATH;
  const now = (deps.now ?? Date.now)();
  const entry = entries.get(name);
  if (entry && entry.pathEnv === pathEnv) {
    if (entry.path !== null) return entry.path;
    if (now < entry.recheckAt) return null;
  }
  const path = lookup(name, pathEnv, deps);
  entries.set(name, { path, pathEnv, recheckAt: path === null ? now + HOST_TOOL_MISSING_RECHECK_MS : 0 });
  return path;
}

/**
 * Reports a spawn failure for `name`. On a spawn-not-found error, drops the
 * cached path and does a fresh lookup, so the tool is marked missing only
 * when that fresh lookup also misses (D4). Ignores every other error.
 */
export function noteHostToolSpawnFailed(name: HostToolName, error: unknown, deps: HostToolDeps = {}): void {
  if (!isSpawnNotFoundError(error)) return;
  entries.delete(name);
  resolveHostTool(name, deps);
}

/** Clears every cached entry, so the next `resolveHostTool` call does a fresh lookup. */
export function refreshHostTools(): void {
  entries.clear();
}

/**
 * True when `error` (or something up to 4 levels down its `.cause` chain) is
 * a Node spawn ENOENT (`code === 'ENOENT'`) or an Effect platform error whose
 * reason is `NotFound` (`reason._tag === 'NotFound'`). Covers both a raw
 * Node `ChildProcess` error and an Effect `PlatformError`/wrapped error such
 * as `TmuxError` that carries the original Node error under `.cause`.
 */
export function isSpawnNotFoundError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (current === null || typeof current !== 'object') return false;
    const candidate = current as { code?: unknown; reason?: { _tag?: unknown }; cause?: unknown };
    if (candidate.code === 'ENOENT') return true;
    if (candidate.reason?._tag === 'NotFound') return true;
    current = candidate.cause;
  }
  return false;
}

/** A Node-shaped ENOENT error for a spawn that was skipped because the tool is missing. */
export function hostToolNotFoundError(name: HostToolName): NodeJS.ErrnoException {
  return Object.assign(new Error(`spawn ${name} ENOENT (skipped: not on PATH)`), {
    code: 'ENOENT',
    errno: -2,
    syscall: `spawn ${name}`,
    path: name,
  });
}

/** Test seam: overrides the lookup used when no `deps.find` is injected, and clears the cache. */
export function setHostToolFinderForTests(find: Finder | null): void {
  testFinder = find;
  entries.clear();
}

/** Test seam: clears the cache and drops the test finder. */
export function resetHostToolsForTests(): void {
  entries.clear();
  testFinder = null;
}
