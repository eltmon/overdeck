/**
 * PAN-3996: `.pan/` ignore detection classifies the deciding rule, and only
 * Overdeck's exact legacy line in the top-level `.gitignore` is ever removed.
 * Temp git repos only; global/system git config is isolated so the host's
 * own excludes cannot leak in.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PlanHomeGitError,
  detectPanIgnore,
  parseCheckIgnoreRecords,
  removeLegacyPanIgnore,
} from '../../../../src/lib/pan-dir/legacy-pan-ignore.js';

let root: string;
let repo: string;

function write(base: string, rel: string, content: string): void {
  const path = join(base, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'legacy-pan-ignore-')));
  write(root, 'empty-gitconfig', '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'empty-gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('detectPanIgnore', () => {
  it('reports not-a-repo for a plain directory and for a missing one', async () => {
    const plain = join(root, 'plain');
    mkdirSync(plain);
    expect(await detectPanIgnore(plain)).toEqual({ kind: 'not-a-repo' });
    expect(await detectPanIgnore(join(root, 'missing'))).toEqual({ kind: 'not-a-repo' });
  });

  it('reports not-ignored when no rule matches .pan/', async () => {
    write(repo, '.gitignore', 'node_modules/\n');
    expect(await detectPanIgnore(repo)).toEqual({ kind: 'not-ignored', repoRoot: repo });
  });

  it.each(['.pan/', '.pan'])('classifies an exact %s line in the top-level .gitignore as legacy', async (pattern) => {
    write(repo, '.gitignore', `node_modules/\n# overdeck\n${pattern}\ndist/\n`);
    expect(await detectPanIgnore(repo)).toEqual({
      kind: 'legacy',
      repoRoot: repo,
      source: join(repo, '.gitignore'),
      line: 3,
      pattern,
    });
  });

  it('classifies a broader or anchored pattern as foreign', async () => {
    write(repo, '.gitignore', '.pan/*\n');
    const status = await detectPanIgnore(repo);
    expect(status).toMatchObject({ kind: 'foreign', source: join(repo, '.gitignore'), line: 1, pattern: '.pan/*' });

    write(repo, '.gitignore', '/.pan/\n');
    expect(await detectPanIgnore(repo)).toMatchObject({ kind: 'foreign', pattern: '/.pan/' });
  });

  it('classifies a nested .gitignore as foreign', async () => {
    write(repo, '.pan/.gitignore', 'drafts/\n');
    expect(await detectPanIgnore(repo)).toMatchObject({
      kind: 'foreign',
      source: join(repo, '.pan', '.gitignore'),
      line: 1,
      pattern: 'drafts/',
    });
  });

  it('classifies .git/info/exclude as foreign', async () => {
    write(repo, '.git/info/exclude', '# excludes\n.pan/\n');
    expect(await detectPanIgnore(repo)).toMatchObject({
      kind: 'foreign',
      source: join(repo, '.git', 'info', 'exclude'),
      line: 2,
      pattern: '.pan/',
    });
  });

  it('classifies core.excludesFile as foreign', async () => {
    const excludes = join(root, 'global-excludes');
    write(root, 'global-excludes', '.pan/\n');
    git(repo, 'config', 'core.excludesFile', excludes);
    expect(await detectPanIgnore(repo)).toMatchObject({ kind: 'foreign', source: excludes, line: 1 });
  });

  it('treats a later negation as not ignored', async () => {
    write(repo, '.gitignore', '.pan/*\n!.pan/drafts/\n!.pan/specs/\n!.pan/continues/\n!.pan/orders/\n!.pan/notes/\n!.pan/backlog/\n');
    expect(await detectPanIgnore(repo)).toEqual({ kind: 'not-ignored', repoRoot: repo });
  });

  it('checks from a plan home nested below the repo root', async () => {
    write(repo, '.gitignore', '.pan/\n');
    const nested = join(repo, 'planning');
    mkdirSync(nested);
    expect(await detectPanIgnore(nested)).toMatchObject({ kind: 'legacy', source: join(repo, '.gitignore'), line: 1 });
  });
});

describe('removeLegacyPanIgnore', () => {
  it('removes exactly the legacy line(s), preserving everything else byte-for-byte', async () => {
    write(repo, '.gitignore', 'node_modules/\r\n.pan/\r\n# keep me\r\ndist/\r\n.pan\r\n');
    const repair = await removeLegacyPanIgnore(repo);

    expect(repair.removed).toEqual([{ line: 5, pattern: '.pan' }, { line: 2, pattern: '.pan/' }]);
    expect(repair.gitignorePath).toBe(join(repo, '.gitignore'));
    expect(repair.status).toEqual({ kind: 'not-ignored', repoRoot: repo });
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('node_modules/\r\n# keep me\r\ndist/\r\n');
  });

  it('never edits a foreign rule, and reports it after removing the legacy line', async () => {
    write(repo, '.gitignore', '.pan/\n');
    write(repo, '.git/info/exclude', '.pan/\n');
    const before = readFileSync(join(repo, '.git/info/exclude'), 'utf8');

    // info/exclude has lower precedence than .gitignore, so the legacy line decides first.
    const repair = await removeLegacyPanIgnore(repo);
    expect(repair.removed).toEqual([{ line: 1, pattern: '.pan/' }]);
    expect(repair.status).toMatchObject({ kind: 'foreign', source: join(repo, '.git', 'info', 'exclude') });
    expect(readFileSync(join(repo, '.git/info/exclude'), 'utf8')).toBe(before);
  });

  it('is a no-op when .pan/ is ignored only by a foreign rule', async () => {
    write(repo, '.gitignore', '.pan/*\n');
    const repair = await removeLegacyPanIgnore(repo);
    expect(repair.removed).toEqual([]);
    expect(repair.gitignorePath).toBeNull();
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('.pan/*\n');
  });
});

describe('parseCheckIgnoreRecords', () => {
  it('parses -v -z records and skips non-matching ones', () => {
    const out = ['.gitignore', '44', '.pan/', '.pan/drafts/x.md', '', '', '', '.pan/specs/y.md', ''].join('\0');
    expect(parseCheckIgnoreRecords(out)).toEqual([
      { source: '.gitignore', line: 44, pattern: '.pan/', path: '.pan/drafts/x.md' },
    ]);
  });
});

describe('PlanHomeGitError', () => {
  it('carries the step and git reason in its message', () => {
    const error = new PlanHomeGitError('add', '/repo', 'The following paths are ignored');
    expect(error).toBeInstanceOf(Error);
    expect(error._tag).toBe('PlanHomeGitError');
    expect(error.message).toBe('git add failed in /repo: The following paths are ignored');
  });
});
