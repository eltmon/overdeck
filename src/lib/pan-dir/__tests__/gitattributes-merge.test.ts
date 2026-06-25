import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const GITATTRIBUTES_PATH = join(REPO_ROOT, '.gitattributes');

// Built-in git merge drivers that need no merge.<name>.driver config.
const GIT_BUILTIN_DRIVERS = new Set(['text', 'binary', 'union']);

function initRepo(dir: string) {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@e.t', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync('git config commit.gpgsign false', { cwd: dir });
}

/**
 * Creates two divergent commits on the same JSONL file, then merges.
 * Returns the post-merge file contents and whether the merge exited cleanly.
 */
function setupDivergentMerge(dir: string, useUnionAttr: boolean) {
  mkdirSync(join(dir, '.beads'), { recursive: true });

  if (useUnionAttr) {
    writeFileSync(join(dir, '.gitattributes'), '.beads/issues.jsonl merge=union\n');
    execSync('git add .gitattributes', { cwd: dir });
  }

  // Initial commit: shared base with one entry
  writeFileSync(join(dir, '.beads', 'issues.jsonl'), '{"id":"base"}\n');
  execSync('git add .beads/issues.jsonl', { cwd: dir });
  execSync('git commit -q -m "init" --allow-empty', { cwd: dir });
  execSync('git branch -M main', { cwd: dir });

  // Branch A: append a second entry from one side
  execSync('git checkout -q -b branch-a', { cwd: dir });
  writeFileSync(join(dir, '.beads', 'issues.jsonl'), '{"id":"base"}\n{"id":"side-a"}\n');
  execSync('git add .beads/issues.jsonl', { cwd: dir });
  execSync('git commit -q -m "append side-a"', { cwd: dir });

  // Back to main: append a different entry from the other side
  execSync('git checkout -q main', { cwd: dir });
  writeFileSync(join(dir, '.beads', 'issues.jsonl'), '{"id":"base"}\n{"id":"side-b"}\n');
  execSync('git add .beads/issues.jsonl', { cwd: dir });
  execSync('git commit -q -m "append side-b"', { cwd: dir });

  // Attempt the merge
  let mergeExitCode = 0;
  try {
    execSync('git merge --no-edit branch-a', { cwd: dir, stdio: 'pipe' });
  } catch {
    mergeExitCode = 1;
  }

  const contents = readFileSync(join(dir, '.beads', 'issues.jsonl'), 'utf-8');
  return { mergeExitCode, contents };
}

describe('gitattributes merge=union for .beads/issues.jsonl', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pan-gitattr-'));
    initRepo(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('union attribute: divergent JSONL appends merge cleanly with both lines present', () => {
    const { mergeExitCode, contents } = setupDivergentMerge(tmp, /* useUnionAttr */ true);

    expect(mergeExitCode, 'merge should exit 0 with union attribute').toBe(0);
    expect(contents, 'merged file must not contain conflict markers').not.toContain('<<<<<<<');
    expect(contents, 'side-a line must be present after merge').toContain('"id":"side-a"');
    expect(contents, 'side-b line must be present after merge').toContain('"id":"side-b"');
  });

  it('control (no union attribute): divergent JSONL appends produce conflict markers', () => {
    const { contents } = setupDivergentMerge(tmp, /* useUnionAttr */ false);

    // Without the union attribute the default 3-way merge conflicts.
    expect(contents, 'conflict markers must appear without union attribute').toContain('<<<<<<<');
  });
});

describe('.gitattributes invariant', () => {
  it('has no inert custom merge drivers (only built-ins: text/binary/union)', () => {
    const raw = readFileSync(GITATTRIBUTES_PATH, 'utf-8');
    const lines = raw.split('\n').filter(l => !l.trimStart().startsWith('#') && l.includes('merge='));

    const inert: string[] = [];
    for (const line of lines) {
      const m = line.match(/merge=(\S+)/);
      if (m && !GIT_BUILTIN_DRIVERS.has(m[1])) {
        inert.push(`${line.trim()} (driver "${m[1]}" is not a built-in)`);
      }
    }

    expect(inert, `Inert merge drivers found in .gitattributes:\n${inert.join('\n')}`).toHaveLength(0);
  });

  it('does not apply a content-merge driver to single-JSON .pan/ state files', () => {
    const raw = readFileSync(GITATTRIBUTES_PATH, 'utf-8');
    const lines = raw.split('\n').filter(l => !l.trimStart().startsWith('#') && l.includes('merge='));

    // Patterns that must NOT carry content-merge drivers (union would corrupt them)
    const singleJsonPatterns = ['.vbrief.json', '.pan/specs/', '.pan/continues/', '.pan/records/'];
    const contentMergeDrivers = new Set(['union', 'text']); // drivers that interleave hunks

    const violations: string[] = [];
    for (const line of lines) {
      const isJsonStatePath = singleJsonPatterns.some(p => line.includes(p));
      if (!isJsonStatePath) continue;
      const m = line.match(/merge=(\S+)/);
      if (m && contentMergeDrivers.has(m[1])) {
        violations.push(`${line.trim()} — "${m[1]}" would corrupt single-JSON state files`);
      }
    }

    expect(
      violations,
      `Content-merge driver applied to single-JSON .pan/ state files:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });
});
