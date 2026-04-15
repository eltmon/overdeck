/**
 * Skill lint module (PAN-709)
 *
 * Validates SKILL.md files for the flywheel-change pipeline.
 * Used by: review-agent (skill lint gate), `pan admin skills audit`.
 *
 * Design:
 * - `lintSkill(path)` does NOT call external tools — pure TS/fs
 * - `audience` is required in strict mode; grace default is 'operator' at read time
 * - Broken skill references = a skill body mentions `/skill-<name>` or `[skill-name]`
 *   where `skill-name` is not found in the skills/ directory
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';

/** Valid audience values per the PAN-709 schema. */
export type SkillAudience = 'operator' | 'agent' | 'both';

/** A single lint error. */
export interface LintError {
  field: string;
  message: string;
}

/** Result of linting a single skill file. */
export interface LintResult {
  valid: boolean;
  errors: LintError[];
  /** Parsed audience value (grace default 'operator' when field is missing). */
  audience: SkillAudience;
}

/** Parsed frontmatter from a SKILL.md file. */
interface SkillFrontmatter {
  name?: string;
  audience?: string;
  description?: string;
  [key: string]: string | undefined;
}

const VALID_AUDIENCES: ReadonlySet<string> = new Set(['operator', 'agent', 'both']);

/**
 * Parse YAML-like frontmatter from a SKILL.md string.
 * Supports simple `key: value` lines only — no multi-line values beyond
 * the `>` folded scalar for description (reads first line only).
 */
function parseFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm: SkillFrontmatter = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.+)?$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const val = (kv[2] || '').trim().replace(/^["'>]/, '').replace(/["']$/, '').trim();
    fm[key] = val;
  }
  return fm;
}

/**
 * Find all skill directory names in the given skills/ directory.
 * Returns a Set of directory names (skill identifiers).
 */
function getKnownSkillNames(skillsDir: string): Set<string> {
  if (!existsSync(skillsDir)) return new Set();
  try {
    return new Set(
      readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== '_template')
        .map(d => d.name)
    );
  } catch {
    return new Set();
  }
}

/**
 * Extract skill references from the body of a SKILL.md.
 * Matches patterns like: `/skill-name`, `[skill-name]`, `skills/skill-name/`
 */
function extractSkillRefs(body: string): string[] {
  const refs = new Set<string>();
  // Match /skill-name or /skill-name/SKILL.md style references
  for (const m of body.matchAll(/\/([a-z][a-z0-9-]+)(?:\/SKILL\.md)?/g)) {
    refs.add(m[1]);
  }
  // Match skills/skill-name/ style references
  for (const m of body.matchAll(/skills\/([a-z][a-z0-9-]+)\//g)) {
    refs.add(m[1]);
  }
  return Array.from(refs);
}

/**
 * Lint a single SKILL.md file at the given absolute path.
 *
 * @param skillPath - Absolute path to the SKILL.md file
 * @param options.strict - If true, missing `audience` is an error (not just a warning).
 *                        Default: true (lint enforces audience).
 * @param options.skillsDir - Directory containing all skill folders, used to check
 *                            references. If omitted, reference checking is skipped.
 * @returns LintResult with valid flag, errors array, and parsed audience.
 */
export function lintSkill(
  skillPath: string,
  options: {
    strict?: boolean;
    skillsDir?: string;
  } = {}
): LintResult {
  const { strict = true, skillsDir } = options;
  const errors: LintError[] = [];
  let audience: SkillAudience = 'operator'; // grace default

  // 1. File must exist
  if (!existsSync(skillPath)) {
    return {
      valid: false,
      errors: [{ field: 'file', message: `File not found: ${skillPath}` }],
      audience,
    };
  }

  let content: string;
  try {
    content = readFileSync(skillPath, 'utf-8');
  } catch (err) {
    return {
      valid: false,
      errors: [{ field: 'file', message: `Cannot read file: ${err}` }],
      audience,
    };
  }

  // 2. Must have YAML frontmatter
  if (!content.startsWith('---\n')) {
    errors.push({ field: 'frontmatter', message: 'Missing YAML frontmatter (must start with ---)' });
    return { valid: false, errors, audience };
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    errors.push({ field: 'frontmatter', message: 'Malformed YAML frontmatter (no closing ---)' });
    return { valid: false, errors, audience };
  }

  // 3. Required fields: name, description
  if (!fm.name || fm.name.trim() === '') {
    errors.push({ field: 'name', message: 'Missing required frontmatter field: name' });
  }
  if (!fm.description || fm.description.trim() === '') {
    errors.push({ field: 'description', message: 'Missing required frontmatter field: description' });
  }

  // 4. audience field — strict: required; grace: default to 'operator'
  if (!fm.audience || fm.audience.trim() === '') {
    if (strict) {
      errors.push({
        field: 'audience',
        message: 'Missing required frontmatter field: audience (must be operator, agent, or both)',
      });
    }
    // audience stays 'operator' (grace default)
  } else {
    const raw = fm.audience.trim();
    if (!VALID_AUDIENCES.has(raw)) {
      errors.push({
        field: 'audience',
        message: `Invalid audience value "${raw}" — must be one of: operator, agent, both`,
      });
    } else {
      audience = raw as SkillAudience;
    }
  }

  // 5. Check for broken skill references (if skillsDir is provided)
  if (skillsDir) {
    const knownSkills = getKnownSkillNames(skillsDir);
    // Only check if we can find known skills
    if (knownSkills.size > 0) {
      const refs = extractSkillRefs(content);
      for (const ref of refs) {
        // Only flag references that look like skill names (dash-separated lowercase)
        // and are NOT known skills. Ignore refs that are just path fragments.
        if (!knownSkills.has(ref) && ref.includes('-') && ref.length > 3) {
          errors.push({
            field: 'reference',
            message: `Broken skill reference: "${ref}" is not a known skill in ${skillsDir}`,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    audience,
  };
}

/**
 * Lint all SKILL.md files in a skills/ directory.
 * Returns a map from skill name → LintResult.
 */
export function lintAllSkills(
  skillsDir: string,
  options: { strict?: boolean } = {}
): Map<string, LintResult> {
  const results = new Map<string, LintResult>();
  if (!existsSync(skillsDir)) return results;

  try {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '_template')
      .map(d => d.name);

    for (const dir of dirs) {
      const skillPath = join(skillsDir, dir, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      results.set(dir, lintSkill(skillPath, { ...options, skillsDir }));
    }
  } catch {
    // Ignore directory read errors
  }

  return results;
}
