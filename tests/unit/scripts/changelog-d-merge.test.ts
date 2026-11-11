import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// PAN-5137: proves the layout, not source code. Two branches that each add their own
// changelog.d/<issue>.md entry file must merge with no conflict, because they are the
// fix for every PR sharing one Upcoming block in changelog.mdx.

const GIT_IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function git(root: string, args: string[]): string {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd: root, encoding: 'utf-8' });
}

describe('changelog.d entry files merge cleanly', () => {
  it('two branches that each add a different entry file merge with no conflict', () => {
    const root = mkdtempSync(join(tmpdir(), 'changelog-d-merge-'));
    tempDirs.push(root);

    git(root, ['init', '--quiet', '-b', 'main']);
    mkdirSync(join(root, 'changelog.d'));
    writeFileSync(join(root, 'changelog.d', 'README.md'), '# changelog.d\n');
    writeFileSync(join(root, 'changelog.mdx'), '<Update label="v0.79.0" description="2026-11-11">\n</Update>\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'base']);

    const pan1 = '#### New\n\n- **Bullet from branch a.**\n';
    const pan2 = '#### Fixed\n\n- **Bullet from branch b.**\n';

    git(root, ['branch', 'a']);
    git(root, ['branch', 'b']);

    git(root, ['checkout', '--quiet', 'a']);
    writeFileSync(join(root, 'changelog.d', 'pan-1.md'), pan1);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'a adds pan-1']);

    git(root, ['checkout', '--quiet', 'b']);
    writeFileSync(join(root, 'changelog.d', 'pan-2.md'), pan2);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'b adds pan-2']);

    git(root, ['checkout', '--quiet', 'main']);

    expect(() => git(root, ['merge', '--no-edit', 'a'])).not.toThrow();
    expect(() => git(root, ['merge', '--no-edit', 'b'])).not.toThrow();

    expect(git(root, ['diff', '--name-only', '--diff-filter=U']).trim()).toBe('');
    expect(readFileSync(join(root, 'changelog.d', 'pan-1.md'), 'utf-8')).toBe(pan1);
    expect(readFileSync(join(root, 'changelog.d', 'pan-2.md'), 'utf-8')).toBe(pan2);
  });
});
