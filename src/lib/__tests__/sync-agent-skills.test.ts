import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { executeAgentSkills, planAgentSkills} from '../harness-skill-sync.js';

// Moved here from src/lib/harness-skill-sync.ts, which no production code called (PAN-3958 CH-8).
/**
 * Every harness whose native skill discovery is supplied by `pan sync`.
 *
 * kimi-code (PAN-1837): confirmed on the shared ~/.agents/skills discovery
 * path — the wi-fixture capture's system prompt listed the same skill
 * catalog Overdeck syncs there, so no second ~/.kimi-code/skills target is
 * needed. Muse Code 1.0.2 also discovers ~/.agents/skills and ~/.claude/skills
 * natively (verified with muse skills list --source user --json).
 */
const SKILL_SYNC_HARNESSES = ['claude-code', 'codex', 'acp', 'pi', 'ohmypi', 'kimi-code', 'opencode', 'muse'] as const;

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
    expect(SKILL_SYNC_HARNESSES).toEqual(['claude-code', 'codex', 'acp', 'pi', 'ohmypi', 'kimi-code', 'opencode', 'muse']);
  });

  it('copies the complete skill bundle into the shared Agent Skills directory', () => {
    const { source, target } = fixture();

    const result = executeAgentSkills({}, target, source);

    expect(result.created).toEqual(expect.arrayContaining(['okf/SKILL.md', 'okf/references/workflow.md']));
    expect(result.created).toHaveLength(2);
    expect(readFileSync(join(target, 'okf', 'SKILL.md'), 'utf-8')).toBe('# OKF\n');
    expect(readFileSync(join(target, 'okf', 'references', 'workflow.md'), 'utf-8')).toBe('# Workflow\n');
    expect(existsSync(join(target, '..', '.overdeck-manifest.json'))).toBe(true);
  });

  it('includes every nested bundle file in the dry-run plan', () => {
    const { source, target } = fixture();

    const plan = planAgentSkills(target, source);

    expect(plan.map((item) => item.name)).toEqual(
      expect.arrayContaining(['okf/SKILL.md', 'okf/references/workflow.md']),
    );
    expect(plan.every((item) => item.status === 'new')).toBe(true);
  });

  it('updates managed files but preserves user-owned skills', () => {
    const { source, target } = fixture();
    executeAgentSkills({}, target, source);
    writeFileSync(join(source, 'okf', 'SKILL.md'), '# Updated OKF\n');
    mkdirSync(join(target, 'personal'), { recursive: true });
    writeFileSync(join(target, 'personal', 'SKILL.md'), '# Personal\n');
    mkdirSync(join(source, 'personal'), { recursive: true });
    writeFileSync(join(source, 'personal', 'SKILL.md'), '# Bundled collision\n');

    const result = executeAgentSkills({}, target, source);

    expect(result.updated).toContain('okf/SKILL.md');
    expect(result.skipped).toContain('personal/SKILL.md');
    expect(readFileSync(join(target, 'personal', 'SKILL.md'), 'utf-8')).toBe('# Personal\n');
  });

  // PAN-4408: 'okf' is a vendored skill (VENDORED_SKILLS in vendored-skills.ts).
  it('replaces a locally modified real copy of a vendored skill and records replacedVendored', () => {
    const { source, target } = fixture();
    executeAgentSkills({}, target, source);
    writeFileSync(join(target, 'okf', 'SKILL.md'), '# Locally edited\n');

    const result = executeAgentSkills({}, target, source);

    expect(result.replacedVendored).toContain('okf/SKILL.md');
    expect(result.conflicts).not.toContain('okf/SKILL.md');
    expect(readFileSync(join(target, 'okf', 'SKILL.md'), 'utf-8')).toBe('# OKF\n');
  });

  it('replaces a differing but unmanifested okf file and records replacedVendored', () => {
    const { source, target } = fixture();
    mkdirSync(join(target, 'okf'), { recursive: true });
    writeFileSync(join(target, 'okf', 'SKILL.md'), '# Stale pre-manifest content\n');

    const result = executeAgentSkills({}, target, source);

    expect(result.replacedVendored).toContain('okf/SKILL.md');
    expect(result.skipped).not.toContain('okf/SKILL.md');
    expect(readFileSync(join(target, 'okf', 'SKILL.md'), 'utf-8')).toBe('# OKF\n');
  });

  it('still reports a locally modified non-vendored skill as a conflict', () => {
    const { source, target } = fixture();
    mkdirSync(join(source, 'other'), { recursive: true });
    writeFileSync(join(source, 'other', 'SKILL.md'), '# Other\n');
    executeAgentSkills({}, target, source);
    writeFileSync(join(target, 'other', 'SKILL.md'), '# Locally edited\n');

    const result = executeAgentSkills({}, target, source);

    expect(result.conflicts).toContain('other/SKILL.md');
    expect(result.replacedVendored).not.toContain('other/SKILL.md');
    expect(readFileSync(join(target, 'other', 'SKILL.md'), 'utf-8')).toBe('# Locally edited\n');
  });

  it('leaves a symlinked okf root untouched and reports a conflict', () => {
    const { source, target } = fixture();
    executeAgentSkills({}, target, source);
    const realDir = join(target, '..', 'user-okf-checkout');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'SKILL.md'), '# User checkout, locally edited\n');
    rmSync(join(target, 'okf'), { recursive: true, force: true });
    symlinkSync(realDir, join(target, 'okf'));

    const result = executeAgentSkills({}, target, source);

    expect(result.conflicts).toContain('okf/SKILL.md');
    expect(result.replacedVendored).not.toContain('okf/SKILL.md');
    expect(readFileSync(join(realDir, 'SKILL.md'), 'utf-8')).toBe('# User checkout, locally edited\n');
  });

  it('planAgentSkills reports symlink for a converging vendored edit and conflict for a symlinked root', () => {
    const { source, target } = fixture();
    executeAgentSkills({}, target, source);
    writeFileSync(join(target, 'okf', 'SKILL.md'), '# Locally edited\n');

    const convergingPlan = planAgentSkills(target, source);
    expect(convergingPlan.find((item) => item.name === 'okf/SKILL.md')).toMatchObject({ status: 'symlink' });

    const realDir = join(target, '..', 'user-okf-checkout');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'SKILL.md'), '# User checkout edit\n');
    rmSync(join(target, 'okf'), { recursive: true, force: true });
    symlinkSync(realDir, join(target, 'okf'));

    const symlinkedPlan = planAgentSkills(target, source);
    expect(symlinkedPlan.find((item) => item.name === 'okf/SKILL.md')).toMatchObject({ status: 'conflict' });
  });
});
