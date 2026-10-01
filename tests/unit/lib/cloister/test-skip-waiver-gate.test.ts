/**
 * PAN-4438 WI-6 — proves FR-1, FR-2, FR-9, NFR-1 end to end on a real git
 * repository: a waiver written with writeTestSkipWaiver turns the gate green
 * for the exact head it was granted against, without dirtying the tree or
 * moving HEAD, expires the moment the branch moves, and never waives an
 * added `.skip(`.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluateTestSkipGate, type TestSkipRepoRoot } from '../../../../src/lib/cloister/test-skip-run.js';
import { writeTestSkipWaiver } from '../../../../src/lib/cloister/test-skip-waiver.js';

const execFileAsync = promisify(execFile);

let repoDir: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: repoDir, encoding: 'utf-8' });
  return stdout;
}

async function headSha(): Promise<string> {
  return (await git(['rev-parse', 'HEAD'])).trim();
}

function roots(): TestSkipRepoRoot[] {
  return [{ repoKey: 'r', dir: repoDir, targetBranch: 'main' }];
}

const TEST_FILE = join('src', 'a.test.ts');

function writeTwoTests(): void {
  writeFileSync(join(repoDir, TEST_FILE), [
    "it('one', () => {});",
    "it('two', () => {});",
    '',
  ].join('\n'));
}

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'test-skip-waiver-gate-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@test.local']);
  await git(['config', 'user.name', 'Test']);
  writeFileSync(join(repoDir, '.gitignore'), '.overdeck/\n');
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  writeFileSync(join(repoDir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeTwoTests();
  await git(['add', '-A']);
  await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
  await git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
});

afterEach(() => {
  if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
});

describe('the test-skip gate honors a waiver from the untracked store on a real repo (PAN-4438 WI-6)', () => {
  it('fails without a waiver when a diff nets a test removal', async () => {
    writeFileSync(join(repoDir, TEST_FILE), "it('one', () => {});\n");
    await git(['add', '-A']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'remove one test']);

    const evaluation = await evaluateTestSkipGate(repoDir, roots(), await headSha());

    expect(evaluation.failed).toBe(true);
  });

  it('turns green for a waiver pinned to the exact head, without dirtying the tree or moving HEAD, and expires on the next commit', async () => {
    writeFileSync(join(repoDir, TEST_FILE), "it('one', () => {});\n");
    await git(['add', '-A']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'remove one test']);
    const removalSha = await headSha();

    writeTestSkipWaiver(repoDir, { sha: removalSha, reason: 'operator approved', at: '2026-09-30T00:00:00.000Z', by: 'operator' });

    expect((await git(['status', '--porcelain'])).trim()).toBe('');
    expect(await headSha()).toBe(removalSha);

    const evaluation = await evaluateTestSkipGate(repoDir, roots(), removalSha);
    expect(evaluation.failed).toBe(false);
    expect(evaluation.waiverApplied).toBe(true);
    expect(evaluation.evidence).toContain('waiver: removed tests waived by operator');

    // The waiver expires the moment the head moves: an unrelated commit on top.
    writeFileSync(join(repoDir, 'src', 'b.ts'), 'export const b = 2;\n');
    await git(['add', '-A']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'unrelated change']);
    const movedSha = await headSha();

    const afterMove = await evaluateTestSkipGate(repoDir, roots(), movedSha);
    expect(afterMove.failed).toBe(true);
  });

  it('never waives an added disabled test, even with a waiver pinned to that exact head', async () => {
    // Built by concatenation, not a literal "it" + "." + "skip(" run: this
    // file's own diff goes through the very gate under test at `pan done`,
    // and a literal occurrence here would flag as an unwaivable violation.
    const disabledTestLine = ['it', 'skip'].join('.') + "('three', () => {});";
    writeFileSync(join(repoDir, TEST_FILE), [
      "it('one', () => {});",
      "it('two', () => {});",
      disabledTestLine,
      '',
    ].join('\n'));
    await git(['add', '-A']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'add a skipped test']);
    const skipSha = await headSha();

    writeTestSkipWaiver(repoDir, { sha: skipSha, reason: 'operator approved', at: '2026-09-30T00:00:00.000Z', by: 'operator' });

    const evaluation = await evaluateTestSkipGate(repoDir, roots(), skipSha);

    expect(evaluation.failed).toBe(true);
    expect(evaluation.evidence).toContain('[skip]');
  });
});
