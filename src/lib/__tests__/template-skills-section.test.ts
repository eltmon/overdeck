/**
 * Tests for generateAgentSkillsSection in template.ts (PAN-709)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateAgentSkillsSection } from '../template.js';

const TEST_DIR = join(tmpdir(), `pan-template-test-${Date.now()}`);
const SKILLS_DIR = join(TEST_DIR, 'skills');

function createSkill(name: string, frontmatter: string, body = '') {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
}

beforeAll(() => {
  mkdirSync(SKILLS_DIR, { recursive: true });

  createSkill('bug-fix', 'name: Bug Fix\naudience: agent\ndescription: "Fix bugs in code"');
  createSkill('all-up', 'name: All Up\naudience: agent\ndescription: Run flywheel');
  createSkill('clear-writing', 'name: Clear Writing\naudience: both\ndescription: Improve writing quality');
  createSkill('pan-up', 'name: pan-up\naudience: operator\ndescription: Start the dashboard');
  createSkill('pan-down', 'name: pan-down\naudience: operator\ndescription: Stop the dashboard');
  createSkill('_template', 'name: Template\naudience: agent\ndescription: Template skill'); // Should be excluded
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('generateAgentSkillsSection', () => {
  it('returns empty string when skills/ directory does not exist', () => {
    const result = generateAgentSkillsSection('/nonexistent/path');
    expect(result).toBe('');
  });

  it('includes agent-audience skills', () => {
    const result = generateAgentSkillsSection(TEST_DIR);
    expect(result).toContain('Bug Fix');
    expect(result).toContain('All Up');
  });

  it('includes both-audience skills', () => {
    const result = generateAgentSkillsSection(TEST_DIR);
    expect(result).toContain('Clear Writing');
  });

  it('excludes operator-audience skills', () => {
    const result = generateAgentSkillsSection(TEST_DIR);
    expect(result).not.toContain('pan-up');
    expect(result).not.toContain('pan-down');
  });

  it('excludes _template directory', () => {
    const result = generateAgentSkillsSection(TEST_DIR);
    expect(result).not.toContain('Template skill');
  });

  it('includes the section header', () => {
    const result = generateAgentSkillsSection(TEST_DIR);
    expect(result).toContain('## Available Skills (agent audience)');
  });

  it('includes relative skill paths as links', () => {
    const result = generateAgentSkillsSection(TEST_DIR);
    expect(result).toContain('skills/bug-fix/SKILL.md');
    expect(result).toContain('skills/all-up/SKILL.md');
    expect(result).toContain('skills/clear-writing/SKILL.md');
  });

  it('includes skill descriptions', () => {
    const result = generateAgentSkillsSection(TEST_DIR);
    expect(result).toContain('Fix bugs in code');
    expect(result).toContain('Run flywheel');
  });

  it('parses a real skill from the repo cleanly', () => {
    // Use the actual retro-workflow skill which has audience: agent
    const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
    const retroSkill = join(repoRoot, 'skills', 'retro-workflow');
    if (!existsSync(retroSkill)) {
      // Skip if not in the right directory
      return;
    }
    const result = generateAgentSkillsSection(repoRoot);
    expect(result).toContain('## Available Skills');
    // Should include retro-workflow
    expect(result).toContain('retro-workflow');
  });
});
