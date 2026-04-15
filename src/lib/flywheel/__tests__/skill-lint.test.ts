/**
 * Unit tests for skill-lint module (PAN-709).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { lintSkill, lintAllSkills } from '../skill-lint.js';

const TEST_DIR = join(tmpdir(), `pan-skill-lint-test-${Date.now()}`);
const SKILLS_DIR = join(TEST_DIR, 'skills');

function createSkill(name: string, content: string): string {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, content);
  return path;
}

beforeAll(() => {
  mkdirSync(SKILLS_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('lintSkill', () => {
  it('returns valid for a well-formed skill', () => {
    const path = createSkill('valid-skill', `---
name: Valid Skill
audience: agent
description: A well-formed skill for testing
---

# Valid Skill

This skill does something useful.
`);
    const result = lintSkill(path);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.audience).toBe('agent');
  });

  it('returns invalid when audience field is missing (strict mode)', () => {
    const path = createSkill('no-audience', `---
name: No Audience
description: Missing audience field
---

# No Audience
`);
    const result = lintSkill(path, { strict: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'audience')).toBe(true);
    expect(result.audience).toBe('operator'); // grace default
  });

  it('returns valid with grace default when audience missing (strict=false)', () => {
    const path = createSkill('no-audience-grace', `---
name: No Audience Grace
description: Missing audience field but grace mode
---

# No Audience Grace
`);
    const result = lintSkill(path, { strict: false });
    expect(result.valid).toBe(true);
    expect(result.audience).toBe('operator'); // grace default applied
  });

  it('returns invalid for unrecognized audience value', () => {
    const path = createSkill('bad-audience', `---
name: Bad Audience
audience: human
description: Invalid audience value
---
`);
    const result = lintSkill(path);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'audience' && e.message.includes('human'))).toBe(true);
  });

  it('accepts all three valid audience values', () => {
    for (const audience of ['operator', 'agent', 'both'] as const) {
      const path = createSkill(`valid-audience-${audience}`, `---
name: Valid ${audience}
audience: ${audience}
description: Test skill with ${audience} audience
---
`);
      const result = lintSkill(path);
      expect(result.valid).toBe(true);
      expect(result.audience).toBe(audience);
    }
  });

  it('returns invalid when name field is missing', () => {
    const path = createSkill('no-name', `---
audience: agent
description: Missing name field
---
`);
    const result = lintSkill(path);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'name')).toBe(true);
  });

  it('returns invalid when description field is missing', () => {
    const path = createSkill('no-description', `---
name: No Description
audience: agent
---
`);
    const result = lintSkill(path);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'description')).toBe(true);
  });

  it('returns invalid when frontmatter is absent', () => {
    const path = createSkill('no-frontmatter', `# No Frontmatter

This skill has no YAML frontmatter.
`);
    const result = lintSkill(path);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'frontmatter')).toBe(true);
  });

  it('detects broken skill references when skillsDir is provided', () => {
    // Create a real skill for the reference to be valid
    createSkill('existing-skill', `---
name: Existing Skill
audience: agent
description: An existing skill for reference testing
---
`);

    const path = createSkill('broken-ref-skill', `---
name: Broken Ref Skill
audience: agent
description: References a non-existent skill
---

# Broken Ref

This skill references /non-existent-skill which does not exist.
`);
    const result = lintSkill(path, { skillsDir: SKILLS_DIR });
    // Should detect the broken reference
    expect(result.errors.some(e => e.field === 'reference' && e.message.includes('non-existent-skill'))).toBe(true);
  });

  it('does not flag valid skill references', () => {
    const path = createSkill('valid-ref-skill', `---
name: Valid Ref Skill
audience: agent
description: References an existing skill
---

See also /existing-skill for more information.
`);
    const result = lintSkill(path, { skillsDir: SKILLS_DIR });
    expect(result.errors.filter(e => e.field === 'reference')).toHaveLength(0);
  });

  it('returns valid: false and file error for non-existent path', () => {
    const result = lintSkill('/nonexistent/path/SKILL.md');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'file')).toBe(true);
  });

  it('parses a real skill from the repo cleanly', () => {
    // Point to the actual workspace skills directory
    const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
    const retroSkillPath = join(repoRoot, 'skills', 'retro-workflow', 'SKILL.md');
    if (!existsSync(retroSkillPath)) return; // Skip if not in right directory

    const result = lintSkill(retroSkillPath, {
      skillsDir: join(repoRoot, 'skills'),
    });
    expect(result.valid).toBe(true);
    expect(result.audience).toBe('agent');
  });
});

describe('lintAllSkills', () => {
  it('returns empty map for non-existent directory', () => {
    const results = lintAllSkills('/nonexistent/skills');
    expect(results.size).toBe(0);
  });

  it('lints all skills in a directory', () => {
    const results = lintAllSkills(SKILLS_DIR);
    expect(results.size).toBeGreaterThan(0);
    // All skills we created should be present
    expect(results.has('valid-skill')).toBe(true);
    expect(results.get('valid-skill')?.valid).toBe(true);
  });

  it('skips _template directory', () => {
    const templatePath = join(SKILLS_DIR, '_template');
    mkdirSync(templatePath, { recursive: true });
    writeFileSync(join(templatePath, 'SKILL.md'), `---\nname: Template\naudience: agent\ndescription: Template\n---\n`);
    const results = lintAllSkills(SKILLS_DIR);
    expect(results.has('_template')).toBe(false);
  });
});
