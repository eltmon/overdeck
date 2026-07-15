import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { executeAgentSkillsSync, planAgentSkillsSync, SKILL_SYNC_HARNESSES } from '../harness-skill-sync.js';

const roots: string[] = [];

function fixture(): { source: string; target: string } {
  const root = join(tmpdir(), `pan-agent-skills-${process.pid}-${roots.length}`);
  roots.push(root);
  const source = join(root, 'source');
  const target = join(root, '.agents', 'skills');
  mkdirSync(join(source, 'okf', 'references'), { recursive: true });
  writeFileSync(join(source, 'okf', 'SKILL.md'), '# OKF\n');
  writeFileSync(join(source, 'okf', 'references', 'workflow.md'), '# Workflow\n');
  return { source, target };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('agent harness skill sync', () => {
  it('ships OKF from the package-included sync source tree', () => {
    expect(existsSync(join(process.cwd(), 'sync-sources', 'skills', 'okf', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'sync-sources', 'skills', 'okf', 'scripts', 'search.py'))).toBe(true);
  });

  it('has a native discovery destination for every supported agent harness', () => {
    expect(SKILL_SYNC_HARNESSES).toEqual(['claude-code', 'codex', 'pi', 'ohmypi']);
  });

  it('copies the complete skill bundle into the shared Agent Skills directory', () => {
    const { source, target } = fixture();

    const result = executeAgentSkillsSync({}, target, source);

    expect(result.created).toEqual(expect.arrayContaining(['okf/SKILL.md', 'okf/references/workflow.md']));
    expect(result.created).toHaveLength(2);
    expect(readFileSync(join(target, 'okf', 'SKILL.md'), 'utf-8')).toBe('# OKF\n');
    expect(readFileSync(join(target, 'okf', 'references', 'workflow.md'), 'utf-8')).toBe('# Workflow\n');
    expect(existsSync(join(target, '..', '.overdeck-manifest.json'))).toBe(true);
  });

  it('includes every nested bundle file in the dry-run plan', () => {
    const { source, target } = fixture();

    const plan = planAgentSkillsSync(target, source);

    expect(plan.map((item) => item.name)).toEqual(
      expect.arrayContaining(['okf/SKILL.md', 'okf/references/workflow.md']),
    );
    expect(plan.every((item) => item.status === 'new')).toBe(true);
  });

  it('updates managed files but preserves user-owned skills', () => {
    const { source, target } = fixture();
    executeAgentSkillsSync({}, target, source);
    writeFileSync(join(source, 'okf', 'SKILL.md'), '# Updated OKF\n');
    mkdirSync(join(target, 'personal'), { recursive: true });
    writeFileSync(join(target, 'personal', 'SKILL.md'), '# Personal\n');
    mkdirSync(join(source, 'personal'), { recursive: true });
    writeFileSync(join(source, 'personal', 'SKILL.md'), '# Bundled collision\n');

    const result = executeAgentSkillsSync({}, target, source);

    expect(result.updated).toContain('okf/SKILL.md');
    expect(result.skipped).toContain('personal/SKILL.md');
    expect(readFileSync(join(target, 'personal', 'SKILL.md'), 'utf-8')).toBe('# Personal\n');
  });
});
