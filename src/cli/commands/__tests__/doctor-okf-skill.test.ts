import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkOkfSkillVersion } from '../doctor-okf-skill.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'doctor-okf-skill-'));
  roots.push(root);
  return root;
}

function writePin(dir: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.okf-skill-version'), `${version}\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('checkOkfSkillVersion', () => {
  it('is ok when every installed copy matches the vendored version', () => {
    const root = makeRoot();
    const vendoredDir = join(root, 'vendored');
    const claudeDir = join(root, 'claude-okf');
    const agentDir = join(root, 'agents-okf');
    writePin(vendoredDir, 'v0.1.0');
    writePin(claudeDir, 'v0.1.0');
    writePin(agentDir, 'v0.1.0');

    const result = checkOkfSkillVersion({
      vendoredDir,
      installed: [
        { label: 'Claude Code', dir: claudeDir },
        { label: 'Agent Skills (Codex, Pi)', dir: agentDir },
      ],
    });

    expect(result).toMatchObject({ name: 'OKF Skill Version', status: 'ok' });
    expect(result.message).toContain('v0.1.0');
    expect(result.message).toContain('2 harness dir(s)');
  });

  it('warns and names the label and stale version when one installed copy is behind', () => {
    const root = makeRoot();
    const vendoredDir = join(root, 'vendored');
    const claudeDir = join(root, 'claude-okf');
    const agentDir = join(root, 'agents-okf');
    writePin(vendoredDir, 'v0.1.0');
    writePin(claudeDir, 'v0.0.9');
    writePin(agentDir, 'v0.1.0');

    const result = checkOkfSkillVersion({
      vendoredDir,
      installed: [
        { label: 'Claude Code', dir: claudeDir },
        { label: 'Agent Skills (Codex, Pi)', dir: agentDir },
      ],
    });

    expect(result.status).toBe('warn');
    expect(result.message).toContain('Claude Code has v0.0.9');
    expect(result.fix).toBe('Run: pan sync');
  });

  it('warns with none when an installed copy has no pin file', () => {
    const root = makeRoot();
    const vendoredDir = join(root, 'vendored');
    const claudeDir = join(root, 'claude-okf');
    writePin(vendoredDir, 'v0.1.0');
    mkdirSync(claudeDir, { recursive: true });

    const result = checkOkfSkillVersion({
      vendoredDir,
      installed: [{ label: 'Claude Code', dir: claudeDir }],
    });

    expect(result.status).toBe('warn');
    expect(result.message).toContain('Claude Code has none');
  });

  it('warns with a re-vendor fix when the vendored pin file is missing', () => {
    const root = makeRoot();
    const vendoredDir = join(root, 'vendored');
    mkdirSync(vendoredDir, { recursive: true });

    const result = checkOkfSkillVersion({ vendoredDir, installed: [] });

    expect(result.status).toBe('warn');
    expect(result.message).toContain('has no .okf-skill-version');
    expect(result.fix).toContain('scripts/vendor-okf-skill.sh');
  });

  it('skips an installed dir that does not exist and stays ok when the rest match', () => {
    const root = makeRoot();
    const vendoredDir = join(root, 'vendored');
    const claudeDir = join(root, 'claude-okf');
    const missingDir = join(root, 'does-not-exist');
    writePin(vendoredDir, 'v0.1.0');
    writePin(claudeDir, 'v0.1.0');

    const result = checkOkfSkillVersion({
      vendoredDir,
      installed: [
        { label: 'Claude Code', dir: claudeDir },
        { label: 'Agent Skills (Codex, Pi)', dir: missingDir },
      ],
    });

    expect(result.status).toBe('ok');
    expect(result.message).toContain('1 harness dir(s)');
  });
});
