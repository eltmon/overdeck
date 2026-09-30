/**
 * OKF skill vendor-skew doctor check (PAN-4408).
 *
 * sync-sources/skills/okf/ is vendored from a release tag of eltmon/okf
 * (scripts/vendor-okf-skill.sh), never edited in place. This warns when an
 * installed copy (Claude Code or the shared Agent Skills directory) is
 * running a version other than what Overdeck currently vendors — the
 * `okf-vendor-pin` CI workflow catches drift in the vendored tree itself,
 * but not a stale local install that `pan sync` hasn't caught up yet.
 */
import { existsSync } from 'fs';
import { join } from 'path';

import { AGENT_SKILLS_DIR, SYNC_SOURCES, SYNC_TARGET } from '../../lib/paths.js';
import { readSkillVersion } from '../../lib/vendored-skills.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-hooks-drift.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export function checkOkfSkillVersion(opts: {
  vendoredDir?: string;
  installed?: Array<{ label: string; dir: string }>;
} = {}): CheckResult {
  const name = 'OKF Skill Version';
  const vendoredDir = opts.vendoredDir ?? join(SYNC_SOURCES.skills, 'okf');
  const installed = opts.installed ?? [
    { label: 'Claude Code', dir: join(SYNC_TARGET.skills, 'okf') },
    { label: 'Agent Skills (Codex, Pi)', dir: join(AGENT_SKILLS_DIR, 'okf') },
  ];

  const vendoredVersion = readSkillVersion(vendoredDir);
  if (vendoredVersion === null) {
    return {
      name,
      status: 'warn',
      message: `${vendoredDir} has no .okf-skill-version`,
      fix: 'Re-vendor: scripts/vendor-okf-skill.sh <tag>',
    };
  }

  const existingInstalled = installed.filter((entry) => existsSync(entry.dir));
  const skewed = existingInstalled.filter((entry) => readSkillVersion(entry.dir) !== vendoredVersion);

  if (skewed.length > 0) {
    const parts = skewed.map((entry) => `${entry.label} has ${readSkillVersion(entry.dir) ?? 'none'}`);
    return {
      name,
      status: 'warn',
      message: `Installed OKF skill differs from vendored ${vendoredVersion}: ${parts.join(', ')}`,
      fix: 'Run: pan sync',
    };
  }

  return {
    name,
    status: 'ok',
    message: `OKF skill ${vendoredVersion} installed in ${existingInstalled.length} harness dir(s)`,
  };
}
