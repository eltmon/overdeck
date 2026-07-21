import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildUatPromoteGitDeps } from '../../../../src/lib/cloister/uat-promote.js';

const SCRIPT_SOURCE = new URL('../../../../scripts/lint-file-size.sh', import.meta.url);

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function bash(cwd: string, args: string[]): string {
  return execFileSync('bash', args, { cwd, encoding: 'utf-8' });
}

function writeLines(root: string, path: string, count: number): void {
  const filePath = join(root, path);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, Array.from({ length: count }, (_, i) => `line ${i}`).join('\n') + '\n');
}

function installFileSizeScript(root: string): void {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'lint-file-size.sh'), readFileSync(SCRIPT_SOURCE, 'utf-8'), { mode: 0o755 });
}

function readBaseline(root: string): string {
  return readFileSync(join(root, 'scripts', 'file-size-baseline.txt'), 'utf-8');
}

function lineCount(root: string, path: string): number {
  return Number(execFileSync('wc', ['-l', join(root, path)], { encoding: 'utf-8' }).trim().split(/\s+/)[0]);
}

describe('buildUatPromoteGitDeps file-size baseline reconciliation', () => {
  it('lowers a stale-high baseline before pushing the promoted UAT merge to main', async () => {
    const root = mkdtempSync(join(tmpdir(), 'uat-promote-baseline-'));
    const origin = join(root, 'origin.git');
    const projectRoot = join(root, 'project');
    const promotedMain = join(root, 'promoted-main');

    git(root, ['init', '--bare', '--initial-branch=main', origin]);
    git(root, ['clone', origin, projectRoot]);
    git(projectRoot, ['config', 'user.email', 'test@example.com']);
    git(projectRoot, ['config', 'user.name', 'Test']);

    installFileSizeScript(projectRoot);
    writeLines(projectRoot, 'src/baselined.ts', 1925);
    writeFileSync(join(projectRoot, 'scripts', 'file-size-baseline.txt'), '1925 src/baselined.ts\n');
    git(projectRoot, ['add', '.']);
    git(projectRoot, ['commit', '--quiet', '-m', 'seed baseline']);
    git(projectRoot, ['push', 'origin', 'main']);

    git(projectRoot, ['checkout', '-b', 'uat/pan-baseline']);
    writeLines(projectRoot, 'src/baselined.ts', 1924);
    git(projectRoot, ['add', 'src/baselined.ts']);
    git(projectRoot, ['commit', '--quiet', '-m', 'shrink baselined file without lowering baseline']);
    git(projectRoot, ['push', '-u', 'origin', 'uat/pan-baseline']);
    git(projectRoot, ['checkout', 'main']);

    const mergeSha = await buildUatPromoteGitDeps(projectRoot).mergeIntoMain('uat/pan-baseline', 'Merge UAT baseline test');

    expect(mergeSha).toMatch(/^[0-9a-f]{40}$/);

    git(root, ['clone', origin, promotedMain]);
    expect(lineCount(promotedMain, 'src/baselined.ts')).toBe(1924);
    expect(readBaseline(promotedMain)).toBe('1924 src/baselined.ts\n');
    expect(bash(promotedMain, ['scripts/lint-file-size.sh'])).toContain('file-size guard passed');
  });
});
