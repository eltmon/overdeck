import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAlsoSyncToolsSync, syncSkillsToToolsSync } from '../../src/lib/multi-tool-sync.js';

const TEST_DIR = join(process.cwd(), '.test-multi-tool-sync');
const SKILLS_DIR = join(TEST_DIR, 'skills');
const PROJECT_DIR = join(TEST_DIR, 'project');

beforeEach(() => {
  mkdirSync(join(SKILLS_DIR, 'my-skill'), { recursive: true });
  mkdirSync(PROJECT_DIR, { recursive: true });
  writeFileSync(join(SKILLS_DIR, 'my-skill', 'SKILL.md'), '# My Skill\n');
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('retired multi-tool sync', () => {
  it('accepts old configuration as a no-op and reports every skill skipped', () => {
    const before = readdirSnapshot(PROJECT_DIR);
    const results = syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, [
      'cursor', 'codex', 'windsurf', 'cline', 'copilot', 'aider',
    ]);
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.written.length === 0)).toBe(true);
    expect(results.every((result) => result.skipped.includes('my-skill'))).toBe(true);
    expect(readdirSnapshot(PROJECT_DIR)).toEqual(before);
  });

  it('does not modify pre-existing native files', () => {
    const files = ['AGENTS.md', 'CONVENTIONS.md'];
    for (const file of files) writeFileSync(join(PROJECT_DIR, file), `user-owned ${file}\n`);
    const before = Object.fromEntries(files.map((file) => [file, readFileSync(join(PROJECT_DIR, file), 'utf-8')]));
    syncSkillsToToolsSync(SKILLS_DIR, PROJECT_DIR, ['codex', 'aider', 'cursor']);
    for (const file of files) expect(readFileSync(join(PROJECT_DIR, file), 'utf-8')).toBe(before[file]);
    expect(existsSync(join(PROJECT_DIR, '.cursor'))).toBe(false);
  });

  it('still parses known tools from legacy project configuration', () => {
    writeFileSync(join(PROJECT_DIR, '.pan.yaml'), 'tools:\n  also_sync:\n    - cursor\n    - unknown-tool\n');
    const tools = resolveAlsoSyncToolsSync(PROJECT_DIR);
    expect(tools).toContain('cursor');
    expect(tools).not.toContain('unknown-tool');
  });
});

function readdirSnapshot(path: string): string[] {
  return existsSync(path) ? [...new Set(requireEntries(path))].sort() : [];
}

function requireEntries(path: string, prefix = ''): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? [relative, ...requireEntries(join(path, entry.name), relative)]
      : [relative];
  });
}
