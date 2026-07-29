/**
 * Resolve a built bundle's bare imports the way Node will at boot.
 *
 * Existence is not bootability. A bundle file can sit on disk in perfect shape
 * while the node_modules it will be loaded against is incomplete, and the only
 * symptom is `ERR_MODULE_NOT_FOUND` after the process has already replaced the
 * healthy one (PAN-3172 for the PTY supervisor, PAN-3264 for the dashboard
 * server). Probing from the bundle's own location turns that into a check a
 * caller can make *before* it launches or switches over.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/** `from "x"`, `import "x"`, and `import("x")` in bundled ESM output. */
const IMPORT_SOURCE_PATTERN = /\b(?:from|import)\s*\(?\s*(["'])([^"'\n]+)\1/g;
/** Bare package specifiers — relative, absolute, and `node:` are always fine. */
const PACKAGE_SPECIFIER_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:\/[^\s]*)?$/;

/**
 * Bare package specifiers the bundle imports but cannot resolve from its own
 * location. Empty means the artifact can start where it sits.
 *
 * Only a genuine module-not-found counts. A package that is present but whose
 * exports refuse the `require` condition still resolves under `import`, so it
 * must not be reported as missing.
 */
export function unresolvedBundleImports(scriptPath: string): string[] {
  const source = readFileSync(scriptPath, 'utf8');
  const requireFrom = createRequire(scriptPath);
  const missing = new Set<string>();

  for (const match of source.matchAll(IMPORT_SOURCE_PATTERN)) {
    const specifier = match[2];
    if (!specifier || !PACKAGE_SPECIFIER_PATTERN.test(specifier)) continue;
    try {
      requireFrom.resolve(specifier);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') missing.add(specifier);
    }
  }

  return [...missing];
}
