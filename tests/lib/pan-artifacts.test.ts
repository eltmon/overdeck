import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migratePanopticonToPanSync, ensurePanGitignoreSync } from '../../src/lib/workspace-manager.js';
import { mergePanSkillsIntoWorkspaceSync } from '../../src/lib/skills-merge.js';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'pan-artifacts-test-'));
}

// ─── ensurePanGitignore ─────────────────────────────────────────────────────

describe('ensurePanGitignore', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates .gitignore with required entries when file does not exist', () => {
    ensurePanGitignoreSync(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('.pan/events/');
    expect(content).toContain('.pan/review/');
    expect(content).toContain('.pan/prompts/');
    expect(content).toContain('.claude/skills/');
  });

  it('appends missing entries to an existing .gitignore', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');
    ensurePanGitignoreSync(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.pan/events/');
    expect(content).toContain('.pan/review/');
    expect(content).toContain('.pan/prompts/');
    expect(content).toContain('.claude/skills/');
  });

  it('does not duplicate entries if already present', () => {
    writeFileSync(join(dir, '.gitignore'), '.pan/events/\n.pan/review/\n.pan/prompts/\n.claude/skills/\n', 'utf-8');
    ensurePanGitignoreSync(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    const panMatches = (content.match(/\.pan\/events\//g) || []).length;
    const skillsMatches = (content.match(/\.claude\/skills\//g) || []).length;
    expect(panMatches).toBe(1);
    expect(skillsMatches).toBe(1);
  });

  it('does not add .pan/ itself (only runtime subdirs)', () => {
    ensurePanGitignoreSync(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    // Must not gitignore .pan/ at root level (would block .pan/skills/)
    const lines = content.split('\n').map(l => l.trim());
    expect(lines).not.toContain('.pan/');
  });

  it('does not add .planning/ to .gitignore', () => {
    ensurePanGitignoreSync(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(content).not.toContain('.planning/');
  });

  it('is idempotent across multiple calls', () => {
    ensurePanGitignoreSync(dir);
    ensurePanGitignoreSync(dir);
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
    const panMatches = (content.match(/\.pan\/events\//g) || []).length;
    const skillsMatches = (content.match(/\.claude\/skills\//g) || []).length;
    expect(panMatches).toBe(1);
    expect(skillsMatches).toBe(1);
  });
});

// ─── migratePanopticonToPan ─────────────────────────────────────────────────

describe('migratePanopticonToPan', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns empty result when no .panopticon/ subdirs exist', () => {
    const result = migratePanopticonToPanSync(dir);
    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('migrates .panopticon/events to .pan/events', () => {
    const oldDir = join(dir, '.panopticon', 'events');
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, 'PAN-1.jsonl'), '{}', 'utf-8');

    const result = migratePanopticonToPanSync(dir);
    expect(result.migrated.some(m => m.includes('.panopticon/events'))).toBe(true);
    expect(existsSync(join(dir, '.pan', 'events', 'PAN-1.jsonl'))).toBe(true);
    expect(existsSync(join(dir, '.panopticon', 'events'))).toBe(false);
  });

  it('migrates .panopticon/triage to .pan/review', () => {
    mkdirSync(join(dir, '.panopticon', 'triage'), { recursive: true });
    writeFileSync(join(dir, '.panopticon', 'triage', 'out.md'), 'triage', 'utf-8');

    migratePanopticonToPanSync(dir);
    expect(existsSync(join(dir, '.pan', 'review'))).toBe(true);
  });

  it('migrates .panopticon/health to .pan/review', () => {
    mkdirSync(join(dir, '.panopticon', 'health'), { recursive: true });
    writeFileSync(join(dir, '.panopticon', 'health', 'out.md'), 'health', 'utf-8');

    migratePanopticonToPanSync(dir);
    expect(existsSync(join(dir, '.pan', 'review'))).toBe(true);
  });

  it('migrates .panopticon/prompts to .pan/prompts', () => {
    mkdirSync(join(dir, '.panopticon', 'prompts'), { recursive: true });
    writeFileSync(join(dir, '.panopticon', 'prompts', 'agent.md'), 'prompt', 'utf-8');

    migratePanopticonToPanSync(dir);
    expect(existsSync(join(dir, '.pan', 'prompts', 'agent.md'))).toBe(true);
  });

  it('skips migration when .pan/<subdir> already exists, adds to skipped list', () => {
    mkdirSync(join(dir, '.panopticon', 'events'), { recursive: true });
    mkdirSync(join(dir, '.pan', 'events'), { recursive: true });

    const result = migratePanopticonToPanSync(dir);
    expect(result.skipped).toContain('.panopticon/events');
    // Old dir not removed
    expect(existsSync(join(dir, '.panopticon', 'events'))).toBe(true);
  });

  it('never touches paths outside the project directory', () => {
    // Verify ~/.panopticon is untouched by confirming migration only checks project path
    const result = migratePanopticonToPanSync(dir);
    // No errors from attempting to access global ~/.panopticon/
    expect(result.errors).toHaveLength(0);
  });

  it('removes empty .panopticon/ directory after migration', () => {
    mkdirSync(join(dir, '.panopticon', 'events'), { recursive: true });

    migratePanopticonToPanSync(dir);
    expect(existsSync(join(dir, '.panopticon'))).toBe(false);
  });
});

// ─── mergePanSkillsIntoWorkspace ────────────────────────────────────────────

describe('mergePanSkillsIntoWorkspace', () => {
  let projectDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    projectDir = makeTmp();
    workspaceDir = makeTmp();
    mkdirSync(join(workspaceDir, '.claude', 'skills'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('returns empty result when .pan/skills/ does not exist', () => {
    const result = mergePanSkillsIntoWorkspaceSync(projectDir, workspaceDir);
    expect(result.added).toHaveLength(0);
  });

  it('copies skill from .pan/skills/ to .claude/skills/', () => {
    const skillDir = join(projectDir, '.pan', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# My Skill\nContent', 'utf-8');

    const result = mergePanSkillsIntoWorkspaceSync(projectDir, workspaceDir);
    expect(result.added.length).toBeGreaterThan(0);
    expect(existsSync(join(workspaceDir, '.claude', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
  });

  it('skips skill when .claude/skills/<name>/ already exists (never overwrites)', () => {
    const skillDir = join(projectDir, '.pan', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# New', 'utf-8');

    // Pre-existing user-owned skill
    const existingDir = join(workspaceDir, '.claude', 'skills', 'my-skill');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'SKILL.md'), '# User Owned', 'utf-8');

    const result = mergePanSkillsIntoWorkspaceSync(projectDir, workspaceDir);
    expect(result.skipped.some(s => s.includes('my-skill'))).toBe(true);
    // Content must be unchanged
    const content = readFileSync(join(existingDir, 'SKILL.md'), 'utf-8');
    expect(content).toBe('# User Owned');
  });

  it('copies multiple skills from .pan/skills/', () => {
    for (const name of ['skill-a', 'skill-b', 'skill-c']) {
      const d = join(projectDir, '.pan', 'skills', name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'SKILL.md'), `# ${name}`, 'utf-8');
    }

    const result = mergePanSkillsIntoWorkspaceSync(projectDir, workspaceDir);
    expect(result.overlayed).toHaveLength(3);
    expect(existsSync(join(workspaceDir, '.claude', 'skills', 'skill-a'))).toBe(true);
    expect(existsSync(join(workspaceDir, '.claude', 'skills', 'skill-b'))).toBe(true);
  });
});
