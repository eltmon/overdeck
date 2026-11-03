import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// PAN-4927 W-INT0 (AC-24): the shared Overdeck skill and its four plugin copies stay byte-identical.
const SCRIPT = new URL('../../../integrations/shared/sync-skill.mjs', import.meta.url).pathname;
const PLATFORMS = ['hermes', 'openclaw', 'grok-build', 'grok-bot'] as const;
const copyPath = (root: string, platform: string) =>
  join(root, 'integrations', platform, 'skills', 'overdeck', 'SKILL.md');

function run(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-skill-'));
  roots.push(root);
  mkdirSync(join(root, 'integrations', 'shared'), { recursive: true });
  writeFileSync(
    join(root, 'integrations', 'shared', 'SKILL.md'),
    '---\nname: fixture\ndescription: fixture skill\n---\n\nbody\n'
  );
  return root;
}

describe('sync-skill.mjs (fixture root)', () => {
  it('writes all four copies byte-identical to the shared skill', () => {
    const root = makeRoot();
    const source = readFileSync(join(root, 'integrations', 'shared', 'SKILL.md'));

    const result = run(['--root', root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skill copies: 4 updated, 0 unchanged');
    for (const platform of PLATFORMS) {
      expect(readFileSync(copyPath(root, platform))).toEqual(source);
    }
  });

  it('check passes when every copy matches', () => {
    const root = makeRoot();
    run(['--root', root]);

    const result = run(['--check', '--root', root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 4 skill copies match');
  });

  it('check fails and names the one edited copy', () => {
    const root = makeRoot();
    run(['--root', root]);
    const path = copyPath(root, 'openclaw');
    writeFileSync(path, readFileSync(path).toString() + 'edited\n');

    const result = run(['--check', '--root', root]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('integrations/openclaw/skills/overdeck/SKILL.md differs');
    expect(result.stderr).not.toContain('integrations/hermes/');
    expect(readFileSync(path, 'utf-8')).toMatch(/edited\n$/);
  });

  it('check fails on a missing copy', () => {
    const root = makeRoot();
    run(['--root', root]);
    unlinkSync(copyPath(root, 'grok-bot'));

    const result = run(['--check', '--root', root]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('integrations/grok-bot/skills/overdeck/SKILL.md is missing');
  });

  it('rejects an unknown flag', () => {
    const result = run(['--bogus']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });
});

describe('integrations/ in this repository', () => {
  it('the committed skill copies match the shared skill', () => {
    const result = run(['--check']);

    expect(result.status).toBe(0);
  });

  it('the shared skill keeps the frontmatter every loader accepts', () => {
    const skillPath = new URL('../../../integrations/shared/SKILL.md', import.meta.url);
    const lines = readFileSync(skillPath, 'utf-8').split('\n');

    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('name: overdeck');
    expect(lines[2]).toMatch(/^description: /);
    expect(lines[2].slice('description: '.length)).not.toContain(': ');
    expect(lines[3]).toBe('---');
  });

  it('the shared skill stays within its context budget', () => {
    const skillPath = new URL('../../../integrations/shared/SKILL.md', import.meta.url);
    const content = readFileSync(skillPath);
    const lineCount = (content.toString('utf-8').match(/\n/g) ?? []).length;

    expect(lineCount).toBeLessThanOrEqual(100);
    expect(content.byteLength).toBeLessThanOrEqual(6000);
  });
});
