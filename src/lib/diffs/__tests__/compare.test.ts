import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import { resolveAllowedDiffRoots, resolveCommit, resolveCompareRepo, validateRefShape } from '../compare.js';

const execFileSpy = vi.mocked(execFile);

let testRoot: string;
let projectRoot: string;
let previousHome: string | undefined;

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
  };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  execFileSync('git', ['add', '.'], { cwd: dir, env });
  execFileSync('git', ['commit', '-q', '-m', 'A'], { cwd: dir, env });
}

beforeAll(() => {
  previousHome = process.env.OVERDECK_HOME;
  testRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pan-4503-compare-')));
  process.env.OVERDECK_HOME = join(testRoot, 'home');
  mkdirSync(process.env.OVERDECK_HOME, { recursive: true });
  projectRoot = join(testRoot, 'project');
  initRepo(join(projectRoot, 'repo'));
});

afterAll(async () => {
  const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
  closeOverdeckDatabase();
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(testRoot, { recursive: true, force: true });
});

beforeEach(() => {
  execFileSpy.mockClear();
});

afterEach(() => {
  execFileSpy.mockClear();
});

describe('validateRefShape', () => {
  it.each(['', '-n', '--output=/tmp/x', 'a..b', 'a b', 'HEAD:file', 'x'.repeat(257), 'tab\there'])(
    'rejects %j with INVALID_REF and spawns no git',
    (ref) => {
      const result = validateRefShape(ref);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe('INVALID_REF');
      expect(execFileSpy).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing ref', () => {
    expect(validateRefShape(null)).toMatchObject({ ok: false, failure: { code: 'INVALID_REF' } });
  });

  it.each(['main', 'v1.0', 'HEAD~2', 'HEAD^', 'origin/main', 'feature/pan-4503', '0123456789abcdef0123456789abcdef01234567'])(
    'accepts %j',
    (ref) => {
      expect(validateRefShape(ref)).toEqual({ ok: true, value: ref });
    },
  );
});

describe('resolveCompareRepo', () => {
  it('accepts a repo inside a containing root and returns its top level', async () => {
    const repo = join(projectRoot, 'repo');
    expect(await resolveCompareRepo(repo, { containing: [projectRoot], exact: [] })).toEqual({ ok: true, value: repo });
    // The spy sees compare.ts's git calls, so the "no git spawned" assertions below are meaningful.
    expect(execFileSpy).toHaveBeenCalledWith('git', ['rev-parse', '--show-toplevel'], expect.anything(), expect.any(Function));
  });

  it('returns the top level when given a subdirectory of the repo', async () => {
    const repo = join(projectRoot, 'repo');
    mkdirSync(join(repo, 'sub'), { recursive: true });
    expect(await resolveCompareRepo(join(repo, 'sub'), { containing: [projectRoot], exact: [] }))
      .toEqual({ ok: true, value: repo });
  });

  it('rejects a sibling repo outside every root without spawning git', async () => {
    const sibling = join(testRoot, 'sibling');
    initRepo(sibling);
    execFileSpy.mockClear();
    const result = await resolveCompareRepo(sibling, { containing: [projectRoot], exact: [] });
    expect(result).toMatchObject({ ok: false, failure: { code: 'REPO_NOT_ALLOWED' } });
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it('rejects a path that only shares a prefix with a containing root', async () => {
    const lookalike = `${projectRoot}-other`;
    initRepo(lookalike);
    const result = await resolveCompareRepo(lookalike, { containing: [projectRoot], exact: [] });
    expect(result).toMatchObject({ ok: false, failure: { code: 'REPO_NOT_ALLOWED' } });
  });

  it('accepts an exact root but rejects a repo nested inside it', async () => {
    const exactRoot = join(testRoot, 'conversation-cwd');
    initRepo(exactRoot);
    const nested = join(exactRoot, 'nested');
    initRepo(nested);
    const roots = { containing: [], exact: [exactRoot] };
    expect(await resolveCompareRepo(exactRoot, roots)).toEqual({ ok: true, value: exactRoot });
    expect(await resolveCompareRepo(nested, roots)).toMatchObject({ ok: false, failure: { code: 'REPO_NOT_ALLOWED' } });
  });

  it('rejects relative, missing and empty paths with INVALID_REPO', async () => {
    const roots = { containing: [projectRoot], exact: [] };
    expect(await resolveCompareRepo('project/repo', roots)).toMatchObject({ ok: false, failure: { code: 'INVALID_REPO' } });
    expect(await resolveCompareRepo(join(projectRoot, 'missing'), roots)).toMatchObject({ ok: false, failure: { code: 'INVALID_REPO' } });
    expect(await resolveCompareRepo(null, roots)).toMatchObject({ ok: false, failure: { code: 'INVALID_REPO' } });
  });

  it('rejects an allowed directory that is not a git repository', async () => {
    const plainRoot = join(testRoot, 'plain');
    mkdirSync(plainRoot, { recursive: true });
    const result = await resolveCompareRepo(plainRoot, { containing: [plainRoot], exact: [] });
    expect(result).toMatchObject({ ok: false, failure: { code: 'NOT_A_GIT_REPO' } });
  });
});

describe('resolveCommit', () => {
  it('resolves HEAD to a full SHA and rejects an unknown ref', async () => {
    const repo = join(projectRoot, 'repo');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
    expect(await resolveCommit(repo, 'HEAD')).toEqual({ ok: true, value: head });
    expect(await resolveCommit(repo, 'nope')).toMatchObject({ ok: false, failure: { code: 'UNKNOWN_REF' } });
  });
});

describe('resolveAllowedDiffRoots', () => {
  it('lists an unarchived conversation cwd as an exact root', async () => {
    const cwd = join(testRoot, 'conv-cwd');
    mkdirSync(cwd, { recursive: true });
    const { createConversation } = await import('../../overdeck/conversations.js');
    createConversation({ name: 'pan-4503-roots', tmuxSession: 'conv-pan-4503-roots', cwd });
    const roots = await resolveAllowedDiffRoots();
    expect(roots.exact).toContain(realpathSync(cwd));
  });
});
