import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GITATTRIBUTES_PATH = fileURLToPath(new URL('../../../.gitattributes', import.meta.url));

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'acceptance-evidence-merge-'));
  tempDirs.push(root);
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, '.gitattributes'), readFileSync(GITATTRIBUTES_PATH, 'utf-8'));
  return root;
}

function writeAcceptanceEvidence(root: string, issueNumber: number): string {
  const body = [
    `# PAN-${issueNumber} acceptance evidence`,
    '',
    '| Step | Result |',
    '| --- | --- |',
    '| 1 | PASS |',
    '',
    '**Result: PASS.**',
    '',
  ].join('\n');
  mkdirSync(join(root, 'apps', 'mobile', 'acceptance'), { recursive: true });
  writeFileSync(join(root, 'apps', 'mobile', 'acceptance', `PAN-${issueNumber}.md`), body);
  return body;
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

function catFileAtTree(root: string, tree: string, path: string): string {
  return execFileSync('git', ['cat-file', '-p', `${tree}:${path}`], {
    cwd: root,
    encoding: 'utf-8',
  });
}

describe('apps/mobile acceptance evidence merge behavior', () => {
  it('the repo gives the phone evidence files no merge driver', () => {
    const output = execFileSync(
      'git',
      ['check-attr', 'merge', '--', 'apps/mobile/ACCEPTANCE.md', 'apps/mobile/acceptance/PAN-1.md'],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    );
    expect(output.trim()).toBe(
      'apps/mobile/ACCEPTANCE.md: merge: unspecified\napps/mobile/acceptance/PAN-1.md: merge: unspecified',
    );
  });

  it('two branches that each add a per-issue evidence file merge cleanly', () => {
    const root = makeTempRepo();
    mkdirSync(join(root, 'apps', 'mobile'), { recursive: true });
    writeFileSync(
      join(root, 'apps', 'mobile', 'ACCEPTANCE.md'),
      '# Phone app acceptance\n\nSmall base file.\n',
    );
    commitAll(root, 'base');

    execFileSync('git', ['checkout', '-b', 'x'], { cwd: root });
    const xBody = writeAcceptanceEvidence(root, 111);
    commitAll(root, 'x adds PAN-111 evidence');

    execFileSync('git', ['checkout', 'main'], { cwd: root });
    execFileSync('git', ['checkout', '-b', 'y'], { cwd: root });
    const yBody = writeAcceptanceEvidence(root, 222);
    commitAll(root, 'y adds PAN-222 evidence');

    const { status, tree } = mergeTree(root, 'x', 'y');

    expect(status).toBe(0);
    expect(catFileAtTree(root, tree, 'apps/mobile/acceptance/PAN-111.md')).toBe(xBody);
    expect(catFileAtTree(root, tree, 'apps/mobile/acceptance/PAN-222.md')).toBe(yBody);
  });
});
