/**
 * Caveman Hook Installation
 *
 * Copies vendored caveman JS hook files and SKILL.md content to
 * ~/.panopticon/hooks/caveman/ and ~/.panopticon/hooks/skills/.
 *
 * Called from 'pan admin hooks install' to ensure caveman hooks are available
 * before workspace creation injects them into .claude/settings.json.
 *
 * File layout after build (tsdown bundles to dist/cli/index.js):
 *   dist/cli/index.js          ← bundle (import.meta.url resolves here)
 *   dist/cli/caveman/          ← non-TS files copied by build:cli
 *     caveman-activate.js
 *     caveman-mode-tracker.js
 *     caveman-config.js
 *     panopticon-caveman-activate.js
 *     caveman-statusline.sh
 *     skills/caveman/SKILL.md
 *     skills/caveman-review/SKILL.md
 */

import { Effect } from 'effect';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { FsError, FsNotFoundError } from '../errors.js';

/** Resolved path for caveman hook dir under ~/.panopticon */
export function getCavemanHooksDir(): string {
  return join(homedir(), '.panopticon', 'hooks', 'caveman');
}

/** Resolved path for caveman skills dir under ~/.panopticon/hooks */
export function getCavemanSkillsDir(): string {
  return join(homedir(), '.panopticon', 'hooks', 'skills');
}

/**
 * Locate the vendored caveman source directory.
 *
 * Since tsdown bundles all TS into dist/cli/index.js, import.meta.url resolves
 * to the bundle itself (dist/cli/index.js) at runtime. Non-TS vendored files are
 * copied to dist/cli/caveman/ by the build:cli script, making them available via
 * dirname(import.meta.url) + '/caveman'.
 */
function findVendoredDir(): string {
  // import.meta.url → file:///.../dist/cli/index.js → __dirname = dist/cli/
  const bundleDir = dirname(fileURLToPath(import.meta.url));
  return join(bundleDir, 'caveman');
}

/**
 * Install caveman hook files from the vendored dist/cli/caveman/ directory
 * into ~/.panopticon/hooks/caveman/.
 *
 * CLI-only — sync FS is acceptable here; this function is only called from
 * 'pan admin hooks install' and is never imported by any dashboard server route.
 *
 * Safe to call multiple times (idempotent).
 * Fails with FsNotFoundError if source files are missing, FsError on IO failures.
 */
export function setupCavemanHooks(): Effect.Effect<void, FsNotFoundError | FsError> {
  return Effect.gen(function* () {
    const vendoredDir = findVendoredDir();

    if (!existsSync(vendoredDir)) {
      return yield* Effect.fail(
        new FsNotFoundError({ path: vendoredDir }),
      );
    }

    const hooksDir = getCavemanHooksDir();
    const skillsDir = getCavemanSkillsDir();

    yield* Effect.try({
      try: () => {
        mkdirSync(hooksDir, { recursive: true });
        mkdirSync(join(skillsDir, 'caveman'), { recursive: true });
        mkdirSync(join(skillsDir, 'caveman-review'), { recursive: true });
      },
      catch: (cause) => new FsError({ path: hooksDir, operation: 'mkdir', cause }),
    });

    const jsFiles = [
      'caveman-activate.js',
      'caveman-mode-tracker.js',
      'caveman-config.js',
      'panopticon-caveman-activate.js',
    ];

    for (const file of jsFiles) {
      const src = join(vendoredDir, file);
      if (!existsSync(src)) {
        return yield* Effect.fail(new FsNotFoundError({ path: src }));
      }
      yield* Effect.try({
        try: () => copyFileSync(src, join(hooksDir, file)),
        catch: (cause) => new FsError({ path: src, operation: 'copy', cause }),
      });
    }

    const statuslineSrc = join(vendoredDir, 'caveman-statusline.sh');
    if (existsSync(statuslineSrc)) {
      const statuslineDest = join(hooksDir, 'caveman-statusline.sh');
      yield* Effect.try({
        try: () => {
          copyFileSync(statuslineSrc, statuslineDest);
          chmodSync(statuslineDest, 0o755);
        },
        catch: (cause) => new FsError({ path: statuslineSrc, operation: 'copy', cause }),
      });
    }

    const skillFiles: Array<[string, string]> = [
      [join(vendoredDir, 'skills', 'caveman', 'SKILL.md'), join(skillsDir, 'caveman', 'SKILL.md')],
      [join(vendoredDir, 'skills', 'caveman-review', 'SKILL.md'), join(skillsDir, 'caveman-review', 'SKILL.md')],
    ];

    for (const [src, dest] of skillFiles) {
      if (!existsSync(src)) {
        return yield* Effect.fail(new FsNotFoundError({ path: src }));
      }
      yield* Effect.try({
        try: () => copyFileSync(src, dest),
        catch: (cause) => new FsError({ path: src, operation: 'copy', cause }),
      });
    }
  });
}

/**
 * Install caveman-compress Python scripts to ~/.panopticon/hooks/caveman-compress/.
 * These scripts let users manually compress static reference docs via pan caveman-compress.
 *
 * CLI-only — sync FS is acceptable here; this function is only called from
 * 'pan admin hooks install' and is never imported by any dashboard server route.
 *
 * Safe to call multiple times (idempotent).
 * Returns true if installation succeeded, false if source files not found (non-fatal).
 * Fails with FsError on IO failures.
 */
export function setupCavemanCompressScripts(): Effect.Effect<boolean, FsError> {
  return Effect.gen(function* () {
    const bundleDir = dirname(fileURLToPath(import.meta.url));
    const compressSrc = join(bundleDir, 'caveman-compress');

    if (!existsSync(compressSrc)) {
      return false;
    }

    const compressDest = join(homedir(), '.panopticon', 'hooks', 'caveman-compress');
    yield* Effect.try({
      try: () => mkdirSync(compressDest, { recursive: true }),
      catch: (cause) => new FsError({ path: compressDest, operation: 'mkdir', cause }),
    });

    const pyFiles = ['__init__.py', '__main__.py', 'cli.py', 'compress.py', 'detect.py', 'validate.py'];
    for (const file of pyFiles) {
      const src = join(compressSrc, file);
      if (!existsSync(src)) continue;
      yield* Effect.try({
        try: () => copyFileSync(src, join(compressDest, file)),
        catch: (cause) => new FsError({ path: src, operation: 'copy', cause }),
      });
    }

    return true;
  });
}
