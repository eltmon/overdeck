/**
 * pan admin skills — skill audit and routing management (PAN-709)
 *
 * pan admin skills audit           — table: skill, audience, sync destination, status
 * pan admin skills audit --fix     — remove stale agent-only skills from devroot
 * pan admin skills audit --json    — JSON output
 */

import { promises as fsPromises } from 'fs';
import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { SKILLS_DIR } from '../../../lib/paths.js';
import { getDevrootPath } from '../../../lib/config.js';
import { lintSkill } from '../../../lib/flywheel/skill-lint.js';

export type SkillAudience = 'operator' | 'agent' | 'both';

export interface SkillAuditRecord {
  name: string;
  audience: SkillAudience;
  syncDestinations: string[];
  missingField: boolean;
  stale: boolean;
}

/**
 * Build the list of sync destinations for a given audience.
 */
function resolveSyncDestinations(audience: SkillAudience, devrootPath: string | undefined): string[] {
  const destinations: string[] = [];
  if (audience === 'operator' || audience === 'both') {
    if (devrootPath) {
      destinations.push(`${devrootPath}/.claude/skills/`);
    } else {
      destinations.push('devroot/.claude/skills/ (devroot disabled)');
    }
  }
  if (audience === 'agent' || audience === 'both') {
    destinations.push('workspace CLAUDE.md (skill table)');
  }
  return destinations;
}

/**
 * Run the skill audit: walk every skills/<name>/SKILL.md, lint it, and return records.
 */
export async function auditSkills(): Promise<SkillAuditRecord[]> {
  const records: SkillAuditRecord[] = [];
  const devrootPath = getDevrootPath();

  if (!existsSync(SKILLS_DIR)) return records;

  const entries = await fsPromises.readdir(SKILLS_DIR, { withFileTypes: true });
  const skillDirs = entries.filter(e => e.isDirectory() && e.name !== '_template');

  for (const skillDir of skillDirs) {
    const skillPath = join(SKILLS_DIR, skillDir.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;

    const result = lintSkill(skillPath, { strict: true, skillsDir: SKILLS_DIR });
    const audience = result.audience;
    const missingField = result.errors.some(e => e.field === 'audience');

    // Check for stale devroot copy: agent-only skills that still exist in devroot
    let stale = false;
    if (audience === 'agent' && devrootPath != null) {
      const devrootSkillPath = join(devrootPath, '.claude', 'skills', skillDir.name);
      stale = existsSync(devrootSkillPath);
    }

    records.push({
      name: skillDir.name,
      audience,
      syncDestinations: resolveSyncDestinations(audience, devrootPath ?? undefined),
      missingField,
      stale,
    });
  }

  // Sort: stale first, then warnings, then alpha
  records.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? -1 : 1;
    if (a.missingField !== b.missingField) return a.missingField ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return records;
}

/**
 * Remove stale agent-only skill directories from the devroot.
 * Returns names of directories removed.
 */
export async function fixStaleSkills(records: SkillAuditRecord[]): Promise<string[]> {
  const removed: string[] = [];
  const devrootPath = getDevrootPath();
  if (devrootPath == null) return removed;

  for (const record of records) {
    if (!record.stale) continue;
    const devrootSkillPath = join(devrootPath, '.claude', 'skills', record.name);
    try {
      await fsPromises.rm(devrootSkillPath, { recursive: true, force: true });
      removed.push(record.name);
    } catch {
      // Non-fatal — report but continue
    }
  }
  return removed;
}

const AUDIENCE_COLORS: Record<SkillAudience, (s: string) => string> = {
  operator: chalk.blue,
  agent: chalk.magenta,
  both: chalk.cyan,
};

/**
 * Print the audit table to stdout.
 */
function printAuditTable(records: SkillAuditRecord[]): void {
  const total = records.length;
  const staleCount = records.filter(r => r.stale).length;
  const missingCount = records.filter(r => r.missingField).length;
  const byAudience = {
    operator: records.filter(r => r.audience === 'operator').length,
    agent: records.filter(r => r.audience === 'agent').length,
    both: records.filter(r => r.audience === 'both').length,
  };

  console.log(chalk.bold(`Skills audit — ${total} skills\n`));
  console.log(
    `  ${chalk.blue(`operator: ${byAudience.operator}`)}  ` +
    `${chalk.magenta(`agent: ${byAudience.agent}`)}  ` +
    `${chalk.cyan(`both: ${byAudience.both}`)}`
  );
  if (staleCount > 0) console.log(chalk.yellow(`  ⚠ ${staleCount} stale devroot cop${staleCount === 1 ? 'y' : 'ies'} (run --fix to remove)`));
  if (missingCount > 0) console.log(chalk.yellow(`  ⚠ ${missingCount} skill${missingCount === 1 ? '' : 's'} missing audience field (defaulting to operator)`));
  console.log('');

  // Column widths
  const nameWidth = Math.max(20, ...records.map(r => r.name.length));
  const audWidth = 8;

  const header = `  ${'SKILL'.padEnd(nameWidth)}  ${'AUDIENCE'.padEnd(audWidth)}  STATUS      SYNC DESTINATION`;
  console.log(chalk.dim(header));
  console.log(chalk.dim('  ' + '─'.repeat(nameWidth + audWidth + 40)));

  for (const record of records) {
    const audColor = AUDIENCE_COLORS[record.audience];
    const name = record.name.padEnd(nameWidth);
    const aud = audColor(record.audience.padEnd(audWidth));

    let status = chalk.green('ok        ');
    if (record.stale) status = chalk.yellow('stale     ');
    else if (record.missingField) status = chalk.yellow('⚠ missing ');

    const dest = record.syncDestinations.join(', ');
    console.log(`  ${name}  ${aud}  ${status}  ${chalk.dim(dest)}`);
  }

  console.log('');
}

interface AuditOptions {
  fix?: boolean;
  json?: boolean;
}

export async function skillsAuditCommand(options: AuditOptions): Promise<void> {
  const records = await auditSkills();

  if (options.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  printAuditTable(records);

  if (options.fix) {
    const stale = records.filter(r => r.stale);
    if (stale.length === 0) {
      console.log(chalk.dim('No stale devroot copies to remove.'));
      return;
    }
    const removed = await fixStaleSkills(records);
    if (removed.length > 0) {
      console.log(chalk.green(`✓ Removed ${removed.length} stale devroot cop${removed.length === 1 ? 'y' : 'ies'}: ${removed.join(', ')}`));
    }
  }
}
