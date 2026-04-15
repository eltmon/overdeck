/**
 * Unit tests for @panopticon/contracts skills schema (PAN-709)
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { parseSkillFrontmatter, SkillFrontmatterParseError } from '@panopticon/contracts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('parseSkillFrontmatter', () => {
  it('parses valid frontmatter with all fields', () => {
    const content = `---
name: Test Skill
audience: agent
description: A test skill
---

# Body
`;
    const fm = parseSkillFrontmatter(content);
    expect(fm.name).toBe('Test Skill');
    expect(fm.audience).toBe('agent');
    expect(fm.description).toBe('A test skill');
  });

  it('defaults audience to operator when field is missing (non-strict)', () => {
    const content = `---
name: No Audience
description: Missing audience
---
`;
    const fm = parseSkillFrontmatter(content);
    expect(fm.audience).toBe('operator');
  });

  it('throws on missing audience in strict mode', () => {
    const content = `---
name: Strict Skill
description: Missing audience strict
---
`;
    expect(() => parseSkillFrontmatter(content, true)).toThrow(SkillFrontmatterParseError);
    expect(() => parseSkillFrontmatter(content, true)).toThrow('audience');
  });

  it('accepts all three valid audience values', () => {
    for (const audience of ['operator', 'agent', 'both'] as const) {
      const content = `---\nname: Test\naudience: ${audience}\ndescription: Test\n---\n`;
      const fm = parseSkillFrontmatter(content);
      expect(fm.audience).toBe(audience);
    }
  });

  it('throws on invalid audience value', () => {
    const content = `---
name: Bad Audience
audience: human
description: Invalid
---
`;
    expect(() => parseSkillFrontmatter(content)).toThrow(SkillFrontmatterParseError);
    expect(() => parseSkillFrontmatter(content)).toThrow('human');
  });

  it('throws on missing name field', () => {
    const content = `---
audience: operator
description: No name here
---
`;
    expect(() => parseSkillFrontmatter(content)).toThrow(SkillFrontmatterParseError);
    expect(() => parseSkillFrontmatter(content)).toThrow('name');
  });

  it('throws on missing description field', () => {
    const content = `---
name: No Desc
audience: operator
---
`;
    expect(() => parseSkillFrontmatter(content)).toThrow(SkillFrontmatterParseError);
    expect(() => parseSkillFrontmatter(content)).toThrow('description');
  });

  it('throws on missing frontmatter entirely', () => {
    const content = `# No Frontmatter\n\nJust body text.\n`;
    expect(() => parseSkillFrontmatter(content)).toThrow(SkillFrontmatterParseError);
    expect(() => parseSkillFrontmatter(content)).toThrow('frontmatter');
  });

  it('parses a real existing skill from the repo cleanly', () => {
    const repoRoot = join(__dirname, '..', '..', '..', 'skills');
    const skillPath = join(repoRoot, 'retro-workflow', 'SKILL.md');
    if (!existsSync(skillPath)) return; // Skip if not in this env

    const content = readFileSync(skillPath, 'utf-8');
    const fm = parseSkillFrontmatter(content);
    expect(fm.name).toBeTruthy();
    expect(fm.description).toBeTruthy();
    expect(['operator', 'agent', 'both']).toContain(fm.audience);
  });
});
