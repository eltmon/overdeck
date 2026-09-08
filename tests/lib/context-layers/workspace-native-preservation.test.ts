import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { copyProjectTemplateDirs } from '../../../src/lib/workspace-manager/worktree-ops.js';
import { isHarnessNativeTarget } from '../../../src/lib/context-layers/native-instructions.js';

describe('workspace template instruction boundary', () => {
  it.each(['CLAUDE.md', 'nested/AGENTS.md', 'nested/AGENTS.override.md', '.claude/CLAUDE.md', 'nested/.claude/rules/rule.md', '../CLAUDE.md'])('protects %s', path => {
    expect(isHarnessNativeTarget(path)).toBe(true);
  });
  it('copies settings and skills while preserving native instructions inside the same directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-workspace-native-'));
    try {
      const source = join(root, 'source');
      const target = join(root, 'workspace');
      mkdirSync(join(source, '.claude', 'skills', 'sample'), { recursive: true });
      mkdirSync(join(source, '.claude', 'rules'));
      mkdirSync(join(target, '.claude'), { recursive: true });
      writeFileSync(join(source, '.claude', 'CLAUDE.md'), 'generated');
      writeFileSync(join(source, '.claude', 'rules', 'example.md'), 'generated rule');
      writeFileSync(join(source, '.claude', 'skills', 'sample', 'SKILL.md'), 'skill');
      writeFileSync(join(source, '.claude', 'settings.json'), '{}');
      writeFileSync(join(target, '.claude', 'CLAUDE.md'), 'user');
      copyProjectTemplateDirs(source, target, ['.claude']);
      expect(readFileSync(join(target, '.claude', 'CLAUDE.md'), 'utf8')).toBe('user');
      expect(readFileSync(join(target, '.claude', 'settings.json'), 'utf8')).toBe('{}');
      expect(readFileSync(join(target, '.claude', 'skills', 'sample', 'SKILL.md'), 'utf8')).toBe('skill');
      expect(existsSync(join(target, '.claude', 'rules'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
