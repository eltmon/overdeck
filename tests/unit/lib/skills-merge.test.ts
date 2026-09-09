import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyProjectTemplateOverlaySync,
  cleanupGitignoreSync,
  cleanupWorkspaceGitignoreSync,
  mergePanSkillsIntoWorkspaceSync,
  mergeSkillsIntoWorkspaceSync,
} from '../../../src/lib/skills-merge.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('retired workspace harness distribution', () => {
  it('leaves project-native files byte-for-byte untouched across every compatibility entry point', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-skills-no-touch-'));
    roots.push(root);
    const nativeDir = join(root, '.claude');
    mkdirSync(join(nativeDir, 'skills', 'lexerra-specific'), { recursive: true });
    const nativeSkill = join(nativeDir, 'skills', 'lexerra-specific', 'SKILL.md');
    const nativeIgnore = join(nativeDir, 'skills', '.gitignore');
    writeFileSync(nativeSkill, '# Lexerra sentinel\n');
    writeFileSync(nativeIgnore, '# user sentinel\n');

    expect(mergeSkillsIntoWorkspaceSync(root).added).toEqual([]);
    expect(mergePanSkillsIntoWorkspaceSync(root, root).added).toEqual([]);
    expect(applyProjectTemplateOverlaySync(root, root)).toEqual([]);
    expect(cleanupGitignoreSync(nativeIgnore).cleaned).toBe(false);
    expect(cleanupWorkspaceGitignoreSync(root).cleaned).toBe(false);

    expect(readFileSync(nativeSkill, 'utf-8')).toBe('# Lexerra sentinel\n');
    expect(readFileSync(nativeIgnore, 'utf-8')).toBe('# user sentinel\n');
  });
});
