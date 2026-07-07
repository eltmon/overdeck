import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isStatePlaneOnlyDiff } from '../../../src/lib/state-plane.js';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();
}

function commitAll(root: string, message: string): string {
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', message, '--quiet']);
  return git(root, ['rev-parse', 'HEAD']);
}

describe('isStatePlaneOnlyDiff', () => {
  let root: string;
  let base: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'state-plane-'));
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(root, 'README.md'), 'base\n');
    base = commitAll(root, 'base');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns true when the diff touches only state-plane paths', async () => {
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    mkdirSync(join(root, '.beads'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'pan-2375.json'), '{}\n');
    writeFileSync(join(root, '.beads', 'issues.jsonl'), '{"id":"PAN-2375"}\n');
    const tip = commitAll(root, 'state only');

    await expect(isStatePlaneOnlyDiff(base, tip, root)).resolves.toBe(true);
  });

  it('returns false when any non-state path changes', async () => {
    mkdirSync(join(root, '.pan', 'records'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, '.pan', 'records', 'pan-2375.json'), '{}\n');
    writeFileSync(join(root, 'src', 'feature.ts'), 'export const feature = true;\n');
    const tip = commitAll(root, 'mixed state and source');

    await expect(isStatePlaneOnlyDiff(base, tip, root)).resolves.toBe(false);
  });

  it('returns false for a diff that touches only .pan/drafts/', async () => {
    mkdirSync(join(root, '.pan', 'drafts'), { recursive: true });
    writeFileSync(join(root, '.pan', 'drafts', 'PAN-2375.md'), '# Draft\n');
    const tip = commitAll(root, 'draft only');

    await expect(isStatePlaneOnlyDiff(base, tip, root)).resolves.toBe(false);
  });

  it('returns true for an empty diff between identical SHAs', async () => {
    await expect(isStatePlaneOnlyDiff(base, base, root)).resolves.toBe(true);
  });
});
