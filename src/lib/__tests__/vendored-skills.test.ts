import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { convergesVendoredSkillFile, readSkillVersion } from '../vendored-skills.js';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'vendored-skills-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('convergesVendoredSkillFile', () => {
  it('is true for a vendored-skill path with a real target directory', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'skills', 'okf'), { recursive: true });

    expect(convergesVendoredSkillFile(root, 'skills/okf/SKILL.md')).toBe(true);
  });

  it('is false when the vendored-skill target root is a symlink', () => {
    const root = makeRoot();
    const real = join(root, 'real-okf');
    mkdirSync(real, { recursive: true });
    mkdirSync(join(root, 'skills'), { recursive: true });
    symlinkSync(real, join(root, 'skills', 'okf'));

    expect(convergesVendoredSkillFile(root, 'skills/okf/SKILL.md')).toBe(false);
  });

  it('is false for a non-vendored skill', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'skills', 'pan-sync'), { recursive: true });

    expect(convergesVendoredSkillFile(root, 'skills/pan-sync/SKILL.md')).toBe(false);
  });

  it('is false for a manifest key outside skills/', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'agents'), { recursive: true });

    expect(convergesVendoredSkillFile(root, 'agents/x.md')).toBe(false);
  });

  it('is false when the target root is missing', () => {
    const root = makeRoot();

    expect(convergesVendoredSkillFile(root, 'skills/okf/SKILL.md')).toBe(false);
  });
});

describe('readSkillVersion', () => {
  it('returns the trimmed pinned tag', () => {
    const root = makeRoot();
    writeFileSync(join(root, '.okf-skill-version'), 'v0.1.0\n');

    expect(readSkillVersion(root)).toBe('v0.1.0');
  });

  it('returns null when the file is missing', () => {
    const root = makeRoot();

    expect(readSkillVersion(root)).toBeNull();
  });

  it('returns null when the file is empty', () => {
    const root = makeRoot();
    writeFileSync(join(root, '.okf-skill-version'), '');

    expect(readSkillVersion(root)).toBeNull();
  });
});
