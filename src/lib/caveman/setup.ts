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

import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

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
 * Returns true if installation succeeded, false if source files not found.
 */
export function setupCavemanHooks(): boolean {
  const vendoredDir = findVendoredDir();

  if (!existsSync(vendoredDir)) {
    console.error(`Caveman: vendored directory not found at ${vendoredDir}`);
    console.error(`Run 'npm run build' first to populate dist/cli/caveman/`);
    return false;
  }

  const hooksDir = getCavemanHooksDir();
  const skillsDir = getCavemanSkillsDir();

  // Ensure target directories exist
  mkdirSync(hooksDir, { recursive: true });
  mkdirSync(join(skillsDir, 'caveman'), { recursive: true });
  mkdirSync(join(skillsDir, 'caveman-review'), { recursive: true });

  // JS hook files to copy
  const jsFiles = [
    'caveman-activate.js',
    'caveman-mode-tracker.js',
    'caveman-config.js',
    'panopticon-caveman-activate.js',
  ];

  for (const file of jsFiles) {
    const src = join(vendoredDir, file);
    if (!existsSync(src)) {
      console.error(`Caveman: missing vendored file ${src}`);
      return false;
    }
    copyFileSync(src, join(hooksDir, file));
  }

  // Statusline script
  const statuslineSrc = join(vendoredDir, 'caveman-statusline.sh');
  if (existsSync(statuslineSrc)) {
    const statuslineDest = join(hooksDir, 'caveman-statusline.sh');
    copyFileSync(statuslineSrc, statuslineDest);
    chmodSync(statuslineDest, 0o755);
  }

  // SKILL.md files — placed relative to hooks dir so caveman-activate.js finds them.
  // caveman-activate.js resolves: path.join(__dirname, '..', 'skills', 'caveman', 'SKILL.md')
  // where __dirname is hooksDir → resolves to skillsDir/caveman/SKILL.md
  const skillFiles: Array<[string, string]> = [
    [join(vendoredDir, 'skills', 'caveman', 'SKILL.md'), join(skillsDir, 'caveman', 'SKILL.md')],
    [join(vendoredDir, 'skills', 'caveman-review', 'SKILL.md'), join(skillsDir, 'caveman-review', 'SKILL.md')],
  ];

  for (const [src, dest] of skillFiles) {
    if (!existsSync(src)) {
      console.error(`Caveman: missing skill file ${src}`);
      return false;
    }
    copyFileSync(src, dest);
  }

  return true;
}

/**
 * Install caveman-compress Python scripts to ~/.panopticon/hooks/caveman-compress/.
 * These scripts let users manually compress static reference docs via pan caveman-compress.
 *
 * CLI-only — sync FS is acceptable here; this function is only called from
 * 'pan admin hooks install' and is never imported by any dashboard server route.
 *
 * Safe to call multiple times (idempotent).
 * Returns true if installation succeeded, false if source files not found.
 */
export function setupCavemanCompressScripts(): boolean {
  const bundleDir = dirname(fileURLToPath(import.meta.url));
  const compressSrc = join(bundleDir, 'caveman-compress');

  if (!existsSync(compressSrc)) {
    // Non-fatal — compress scripts are optional
    return false;
  }

  const compressDest = join(homedir(), '.panopticon', 'hooks', 'caveman-compress');
  mkdirSync(compressDest, { recursive: true });

  const pyFiles = ['__init__.py', '__main__.py', 'cli.py', 'compress.py', 'detect.py', 'validate.py'];
  for (const file of pyFiles) {
    const src = join(compressSrc, file);
    if (!existsSync(src)) continue;
    copyFileSync(src, join(compressDest, file));
  }

  return true;
}
