import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GITATTRIBUTES_PATH = fileURLToPath(new URL('../../../.gitattributes', import.meta.url));

function unionRuleLine(): string {
  const line = readFileSync(GITATTRIBUTES_PATH, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith('scripts/frontend-test-subset.txt'));
  if (!line) throw new Error('scripts/frontend-test-subset.txt union rule not found in .gitattributes');
  return line;
}

function makeTempRepo(withUnionRule: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'frontend-subset-merge-'));
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  if (withUnionRule) {
    writeFileSync(join(root, '.gitattributes'), `${unionRuleLine()}\n`);
  }
  return root;
}

function writeList(root: string, lines: string[]): void {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'frontend-test-subset.txt'), `${lines.join('\n')}\n`);
}

function commitAll(root: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: root });
}

function mergeTree(root: string, branchA: string, branchB: string): { status: number; tree: string } {
  try {
    const output = execFileSync('git', ['merge-tree', '--write-tree', branchA, branchB], {
      cwd: root,
      encoding: 'utf-8',
    });
    return { status: 0, tree: output.trim().split('\n')[0] };
  } catch (err: any) {
    return { status: err.status ?? 1, tree: '' };
  }
}

function listAtTree(root: string, tree: string): string {
  return execFileSync('git', ['cat-file', '-p', `${tree}:scripts/frontend-test-subset.txt`], {
    cwd: root,
    encoding: 'utf-8',
  });
}

describe('scripts/frontend-test-subset.txt merge behavior', () => {
  it('the repo marks the subset list merge=union', () => {
    const output = execFileSync('git', ['check-attr', 'merge', '--', 'scripts/frontend-test-subset.txt'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    expect(output.trim()).toBe('scripts/frontend-test-subset.txt: merge: union');
  });

  it('two branches adding different lines at the same spot merge cleanly', () => {
    const root = makeTempRepo(true);
    writeList(root, ['a.test.ts', 'c.test.ts']);
    commitAll(root, 'base');

    execFileSync('git', ['checkout', '-b', 'x'], { cwd: root });
    writeList(root, ['a.test.ts', 'b1.test.ts', 'c.test.ts']);
    commitAll(root, 'x adds b1');

    execFileSync('git', ['checkout', 'main'], { cwd: root });
    execFileSync('git', ['checkout', '-b', 'y'], { cwd: root });
    writeList(root, ['a.test.ts', 'b2.test.ts', 'c.test.ts']);
    commitAll(root, 'y adds b2');

    const { status, tree } = mergeTree(root, 'x', 'y');

    expect(status).toBe(0);
    const merged = listAtTree(root, tree);
    expect(merged).toContain('b1.test.ts');
    expect(merged).toContain('b2.test.ts');
  });

  it('without the union rule the same edits conflict', () => {
    const root = makeTempRepo(false);
    writeList(root, ['a.test.ts', 'c.test.ts']);
    commitAll(root, 'base');

    execFileSync('git', ['checkout', '-b', 'x'], { cwd: root });
    writeList(root, ['a.test.ts', 'b1.test.ts', 'c.test.ts']);
    commitAll(root, 'x adds b1');

    execFileSync('git', ['checkout', 'main'], { cwd: root });
    execFileSync('git', ['checkout', '-b', 'y'], { cwd: root });
    writeList(root, ['a.test.ts', 'b2.test.ts', 'c.test.ts']);
    commitAll(root, 'y adds b2');

    const { status } = mergeTree(root, 'x', 'y');

    expect(status).toBe(1);
  });

  it('without the union rule, inserts into different gaps still merge cleanly', () => {
    const root = makeTempRepo(false);
    writeList(root, ['a.test.ts', 'c.test.ts', 'e.test.ts']);
    commitAll(root, 'base');

    execFileSync('git', ['checkout', '-b', 'p'], { cwd: root });
    writeList(root, ['a.test.ts', 'b.test.ts', 'c.test.ts', 'e.test.ts']);
    commitAll(root, 'p adds b');

    execFileSync('git', ['checkout', 'main'], { cwd: root });
    execFileSync('git', ['checkout', '-b', 'q'], { cwd: root });
    writeList(root, ['a.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts']);
    commitAll(root, 'q adds d');

    const { status, tree } = mergeTree(root, 'p', 'q');

    expect(status).toBe(0);
    const merged = listAtTree(root, tree);
    expect(merged).toContain('b.test.ts');
    expect(merged).toContain('d.test.ts');
  });
});
