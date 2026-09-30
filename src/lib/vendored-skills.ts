import { existsSync, lstatSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Skills vendored from an upstream release (PAN-4408). Their canonical home is
 * another repo (the OKF skill: eltmon/okf), so `pan sync` converges installed
 * copies instead of preserving local edits.
 */
export const VENDORED_SKILLS: readonly string[] = ['okf'];

/** Pin file written by scripts/vendor-okf-skill.sh: the vendored tag. */
export const OKF_SKILL_VERSION_FILE = '.okf-skill-version';

/**
 * True when `manifestKey` (`skills/<name>/<path>`) belongs to a vendored skill
 * whose root under `targetBase` is a real directory. A symlinked root is the
 * user's own checkout; sync must not write local-edit replacements through it.
 */
export function convergesVendoredSkillFile(targetBase: string, manifestKey: string): boolean {
  try {
    const match = manifestKey.match(/^skills\/([^/]+)\//);
    if (!match || !VENDORED_SKILLS.includes(match[1])) {
      return false;
    }
    const stat = lstatSync(join(targetBase, 'skills', match[1]));
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The trimmed first line of `<skillDir>/.okf-skill-version`, or null when absent or empty. */
export function readSkillVersion(skillDir: string): string | null {
  const versionFile = join(skillDir, OKF_SKILL_VERSION_FILE);
  if (!existsSync(versionFile)) {
    return null;
  }
  const trimmed = readFileSync(versionFile, 'utf-8').trim();
  return trimmed.length > 0 ? trimmed : null;
}
