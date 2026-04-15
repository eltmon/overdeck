/**
 * Skill frontmatter schema — @panopticon/contracts (PAN-709)
 *
 * Canonical type and parser for SKILL.md frontmatter across all consumers:
 * pan sync, skill-lint, review-agent, pan admin skills audit.
 */

/** Valid audience values. Controls where the skill is synced and visible. */
export type SkillAudience = 'operator' | 'agent' | 'both';

/** All recognized frontmatter fields for a SKILL.md file. */
export interface SkillFrontmatter {
  /** Display name for the skill. Required. */
  name: string;
  /**
   * Intended audience for the skill.
   * - 'operator': synced to devroot/.claude/skills/ (CLI user context)
   * - 'agent': referenced in workspace CLAUDE.md only (not synced to devroot)
   * - 'both': synced to devroot AND referenced in workspace CLAUDE.md
   *
   * Read-time default: 'operator' (backward compat for skills without this field).
   */
  audience: SkillAudience;
  /** Short description of what the skill does. Required. */
  description: string;
  /** Additional frontmatter fields (forwarded without validation). */
  [key: string]: string | SkillAudience;
}

const VALID_AUDIENCES: ReadonlySet<string> = new Set<SkillAudience>(['operator', 'agent', 'both']);

export class SkillFrontmatterParseError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'SkillFrontmatterParseError';
  }
}

/**
 * Parse SKILL.md frontmatter from raw file content.
 *
 * Rules:
 * - File must start with `---\n` and have a closing `---` line
 * - `name` and `description` are required; throws if missing
 * - `audience` is optional at the file level; defaults to `'operator'` for backward compat
 * - An invalid `audience` value (not operator/agent/both) throws SkillFrontmatterParseError
 *
 * @param content - Raw text content of the SKILL.md file
 * @param strict  - If true, missing `audience` is an error instead of defaulting to 'operator'
 * @throws {SkillFrontmatterParseError} on missing required fields or invalid audience value
 */
export function parseSkillFrontmatter(content: string, strict = false): SkillFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new SkillFrontmatterParseError('frontmatter', 'Missing or malformed YAML frontmatter (must start with --- and have a closing ---)');
  }

  const raw: Record<string, string> = {};
  const lines = match[1].split('\n');
  let blockKey: string | null = null; // key whose value is a YAML block scalar
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // If we're inside a block scalar, collect first non-empty line as the value
    if (blockKey !== null) {
      if (line.match(/^\s+\S/)) {
        // Indented continuation — use as value if not yet set
        if (!raw[blockKey]) {
          raw[blockKey] = line.trim();
        }
        continue;
      } else {
        blockKey = null; // Block scalar ended
      }
    }

    const kv = line.match(/^([\w-]+):\s*(.+)?$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const rawVal = (kv[2] || '').trim();

    // Detect YAML block scalar indicators (> or |)
    if (rawVal === '>' || rawVal === '|' || rawVal === '>-' || rawVal === '|-') {
      blockKey = key;
      raw[key] = ''; // Will be filled by first continuation line
      continue;
    }

    raw[key] = rawVal.replace(/^["']/, '').replace(/["']$/, '').trim();
  }

  if (!raw['name'] || raw['name'].trim() === '') {
    throw new SkillFrontmatterParseError('name', 'Missing required frontmatter field: name');
  }
  if (!raw['description'] || raw['description'].trim() === '') {
    throw new SkillFrontmatterParseError('description', 'Missing required frontmatter field: description');
  }

  let audience: SkillAudience = 'operator'; // read-time default
  if (!raw['audience'] || raw['audience'].trim() === '') {
    if (strict) {
      throw new SkillFrontmatterParseError(
        'audience',
        'Missing required frontmatter field: audience (must be operator, agent, or both)',
      );
    }
    // Non-strict: silently default to 'operator' for backward compat
  } else {
    const rawAud = raw['audience'].trim();
    if (!VALID_AUDIENCES.has(rawAud)) {
      throw new SkillFrontmatterParseError(
        'audience',
        `Invalid audience value "${rawAud}" — must be one of: operator, agent, both`,
      );
    }
    audience = rawAud as SkillAudience;
  }

  const fm: SkillFrontmatter = { name: raw['name'], audience, description: raw['description'] };
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'name' && k !== 'audience' && k !== 'description') {
      fm[k] = v;
    }
  }
  return fm;
}
