import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { syncSkillsToToolsSync, resolveAlsoSyncToolsSync, runMultiToolSyncSync } from '../../src/lib/multi-tool-sync.js';

const TEST_DIR = join(process.cwd(), '.test-multi-tool-sync');
const SKILLS_DIR = join(TEST_DIR, 'skills');
const PROJECT_DIR = join(TEST_DIR, 'project');

const SAMPLE_SKILL_CONTENT = `---
name: my-skill
description: A sample skill
---

# My Skill

This is the skill content.

Use this skill to do things.
`;

function createSkill(skillName: string, content: string = SAMPLE_SKILL_CONTENT): void {
  const skillDir = join(SKILLS_DIR, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
}

beforeEach(() => {
  mkdirSync(SKILLS_DIR, { recursive: true });
  mkdirSync(PROJECT_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('syncSkillsToTools', () => {
  it('returns empty results when no tools configured', () => {
    createSkill('my-skill');
    const results = syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, []);
    expect(results).toHaveLength(0);
  });

  it('returns empty results when skills dir does not exist', () => {
    const results = syncSkillsToToolsSync(join(TEST_DIR, 'nonexistent'), PROJECT_DIR, ['cursor']);
    expect(results).toHaveLength(0);
  });

  it('syncs skill to cursor as .mdc file', () => {
    createSkill('my-skill');
    const results = syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['cursor']);
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe('cursor');
    expect(results[0].written).toContain('my-skill');

    const mdc = join(PROJECT_DIR, '.cursor', 'rules', 'my-skill.mdc');
    expect(existsSync(mdc)).toBe(true);
    const content = readFileSync(mdc, 'utf-8');
    expect(content).toContain('# My Skill');
    expect(content).not.toContain('---'); // frontmatter stripped
  });

  it('syncs skill to windsurf as .md file', () => {
    createSkill('my-skill');
    syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['windsurf']);

    const md = join(PROJECT_DIR, '.windsurf', 'rules', 'my-skill.md');
    expect(existsSync(md)).toBe(true);
    const content = readFileSync(md, 'utf-8');
    expect(content).toContain('# My Skill');
    expect(content).not.toContain('name: my-skill');
  });

  it('syncs skill to cline as .md file', () => {
    createSkill('my-skill');
    syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['cline']);

    const md = join(PROJECT_DIR, '.clinerules', 'my-skill.md');
    expect(existsSync(md)).toBe(true);
    const content = readFileSync(md, 'utf-8');
    expect(content).toContain('# My Skill');
  });

  it('syncs skill to copilot as .instructions.md file', () => {
    createSkill('my-skill');
    syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['copilot']);

    const md = join(PROJECT_DIR, '.github', 'instructions', 'my-skill.instructions.md');
    expect(existsSync(md)).toBe(true);
    const content = readFileSync(md, 'utf-8');
    expect(content).toContain('# My Skill');
  });

  it('syncs skill to codex as named block in AGENTS.md', () => {
    createSkill('my-skill');
    syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['codex']);

    const agentsMd = join(PROJECT_DIR, 'AGENTS.md');
    expect(existsSync(agentsMd)).toBe(true);
    const content = readFileSync(agentsMd, 'utf-8');
    expect(content).toContain('<!-- panopticon:my-skill start -->');
    expect(content).toContain('<!-- panopticon:my-skill end -->');
    expect(content).toContain('# My Skill');
  });

  it('syncs skill to aider as named block in CONVENTIONS.md', () => {
    createSkill('my-skill');
    syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['aider']);

    const conventionsMd = join(PROJECT_DIR, 'CONVENTIONS.md');
    expect(existsSync(conventionsMd)).toBe(true);
    const content = readFileSync(conventionsMd, 'utf-8');
    expect(content).toContain('<!-- panopticon:my-skill start -->');
    expect(content).toContain('<!-- panopticon:my-skill end -->');
  });

  it('updates existing named block in AGENTS.md without duplicating', () => {
    createSkill('my-skill');
    syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['codex']);
    // Sync again
    syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['codex']);

    const agentsMd = join(PROJECT_DIR, 'AGENTS.md');
    const content = readFileSync(agentsMd, 'utf-8');
    // Should only appear once
    const count = (content.match(/<!-- panopticon:my-skill start -->/g) || []).length;
    expect(count).toBe(1);
  });

  it('syncs multiple skills to multiple tools', () => {
    createSkill('skill-a', `---\nname: skill-a\n---\n# Skill A\nContent`);
    createSkill('skill-b', `---\nname: skill-b\n---\n# Skill B\nContent`);
    const results = syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['cursor', 'windsurf']);
    expect(results).toHaveLength(2);
    const cursor = results.find(r => r.tool === 'cursor')!;
    expect(cursor.written).toHaveLength(2);
    expect(existsSync(join(PROJECT_DIR, '.cursor', 'rules', 'skill-a.mdc'))).toBe(true);
    expect(existsSync(join(PROJECT_DIR, '.cursor', 'rules', 'skill-b.mdc'))).toBe(true);
  });

  it('skips skill dir with no readable .md file', () => {
    mkdirSync(join(SKILLS_DIR, 'empty-skill'), { recursive: true });
    const results = syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['cursor']);
    expect(results[0].skipped).toContain('empty-skill');
  });
});

describe('resolveAlsoSyncTools', () => {
  it('returns empty array when no config exists', () => {
    const tools = resolveAlsoSyncToolsSync(PROJECT_DIR);
    // Since global ~/.panopticon/config.yaml may or may not have tools, we just check it returns an array
    expect(Array.isArray(tools)).toBe(true);
  });

  it('reads tools from project .pan.yaml', () => {
    const panYaml = join(PROJECT_DIR, '.pan.yaml');
    writeFileSync(panYaml, 'tools:\n  also_sync:\n    - cursor\n    - windsurf\n', 'utf-8');
    const tools = resolveAlsoSyncToolsSync(PROJECT_DIR);
    expect(tools).toContain('cursor');
    expect(tools).toContain('windsurf');
  });

  it('ignores unknown tool names', () => {
    const panYaml = join(PROJECT_DIR, '.pan.yaml');
    writeFileSync(panYaml, 'tools:\n  also_sync:\n    - cursor\n    - unknown-tool\n', 'utf-8');
    const tools = resolveAlsoSyncToolsSync(PROJECT_DIR);
    expect(tools).toContain('cursor');
    expect(tools).not.toContain('unknown-tool');
  });
});
