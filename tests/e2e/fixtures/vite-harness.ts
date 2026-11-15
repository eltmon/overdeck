/**
 * Shared pieces of the tests/e2e Vite harnesses (PAN-5298).
 *
 * Every harness serves src/dashboard/frontend. Without a cacheDir they all share
 * its node_modules/.vite, and each optimizer commit replaces that deps/ folder,
 * so specs running in one CI shard swap the dependency files each other serve.
 * Each harness therefore gets a private cache dir, deleted in afterAll.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';

/** A fresh, private Vite cacheDir under <projectRoot>/.cache/vite-e2e/ (gitignored). */
export async function createViteCacheDir(projectRoot: string, label: string): Promise<string> {
  const parent = join(projectRoot, '.cache', 'vite-e2e');
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, `${label}-`));
}

/** Delete a cache dir made by createViteCacheDir; a no-op for undefined. */
export async function removeViteCacheDir(cacheDir: string | undefined): Promise<void> {
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
}

/**
 * vite.config.ts's pdfjs-dist-assets alias. pdfDocument.ts's import.meta.glob
 * needs it; without it the dependency scan fails and Vite re-optimizes during
 * page loads (504 Outdated Optimize Dep, then a reload).
 */
export function pdfjsAssetsAlias(resolvePackage: (specifier: string) => string): { find: string; replacement: string } {
  return { find: 'pdfjs-dist-assets', replacement: dirname(realpathSync(resolvePackage('pdfjs-dist/package.json'))) };
}

type ViteLogger = {
  info(msg: string, options?: unknown): void;
  warn(msg: string, options?: unknown): void;
  warnOnce(msg: string, options?: unknown): void;
  error(msg: string, options?: unknown): void;
  clearScreen(type: string): void;
  hasErrorLogged(error: unknown): boolean;
  hasWarned: boolean;
};

/**
 * A Vite customLogger that records every info/warn/error line into `lines`
 * (for failure messages) and forwards every call to an error-level Vite
 * logger. The base logger keeps Vite's own state (hasWarned, warnOnce
 * de-duplication, hasErrorLogged) and prints only errors, as logLevel 'error'
 * did. Vite uses a customLogger as-is (createLogger returns it unchanged), so
 * the wrapper must keep that state itself by forwarding. `createLogger` is
 * vite's own export, passed in because the harness imports vite dynamically.
 */
export function createRecordingLogger(
  createLogger: (level: 'error') => ViteLogger,
  lines: string[],
): ViteLogger {
  const base = createLogger('error');
  const warnedOnce = new Set<string>();
  return {
    info(msg, options) { lines.push(`info  ${msg}`); base.info(msg, options); },
    warn(msg, options) { lines.push(`warn  ${msg}`); base.warn(msg, options); },
    warnOnce(msg, options) {
      if (!warnedOnce.has(msg)) { warnedOnce.add(msg); lines.push(`warn  ${msg}`); }
      base.warnOnce(msg, options);
    },
    error(msg, options) { lines.push(`error ${msg}`); base.error(msg, options); },
    clearScreen(type) { base.clearScreen(type); },
    hasErrorLogged(error) { return base.hasErrorLogged(error); },
    get hasWarned() { return base.hasWarned; },
    set hasWarned(value: boolean) { base.hasWarned = value; },
  };
}
