import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNNER = fileURLToPath(new URL('../../../scripts/run-frontend-test-subset.mjs', import.meta.url));

function makeFixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'frontend-subset-'));
}

function writeList(dir: string, contents: string): string {
  const listPath = join(dir, 'list.txt');
  writeFileSync(listPath, contents);
  return listPath;
}

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [RUNNER, ...args], { encoding: 'utf-8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err: any) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

describe('run-frontend-test-subset.mjs', () => {
  it('prints the dry-run command for a list with comments, blanks, and two paths', () => {
    const dir = makeFixtureDir();
    const listPath = writeList(
      dir,
      [
        '# a comment',
        '',
        'src/__tests__/one.test.ts',
        'src/__tests__/two.test.tsx',
        '',
      ].join('\n'),
    );

    const { status, stdout } = run(['--list', listPath, '--dry-run']);

    expect(status).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({
      command: 'npm',
      args: [
        '--prefix',
        './src/dashboard/frontend',
        'run',
        'test',
        '--',
        'src/__tests__/one.test.ts',
        'src/__tests__/two.test.tsx',
      ],
    });
  });

  it('dedupes a path that appears twice, keeping the first occurrence', () => {
    const dir = makeFixtureDir();
    const listPath = writeList(
      dir,
      ['src/__tests__/one.test.ts', 'src/__tests__/one.test.ts'].join('\n'),
    );

    const { status, stdout } = run(['--list', listPath, '--dry-run']);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.args.filter((a: string) => a === 'src/__tests__/one.test.ts')).toHaveLength(1);
  });

  it('forwards extra arguments after the paths', () => {
    const dir = makeFixtureDir();
    const listPath = writeList(dir, 'src/__tests__/one.test.ts\n');

    const { status, stdout } = run(['--list', listPath, '--dry-run', '--reporter=dot']);

    expect(status).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.args.slice(-2)).toEqual(['src/__tests__/one.test.ts', '--reporter=dot']);
  });

  it('exits 1 and names the list path when the list has only comments', () => {
    const dir = makeFixtureDir();
    const listPath = writeList(dir, '# nothing but comments\n\n');

    const { status, stderr } = run(['--list', listPath, '--dry-run']);

    expect(status).toBe(1);
    expect(stderr).toContain(listPath);
  });

  it('exits 1 and names the list path when the list file does not exist', () => {
    const dir = makeFixtureDir();
    const listPath = join(dir, 'missing.txt');

    const { status, stderr } = run(['--list', listPath, '--dry-run']);

    expect(status).toBe(1);
    expect(stderr).toContain(listPath);
  });
});
