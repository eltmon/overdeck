import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const projectsMocks = vi.hoisted(() => ({ findProjectByPath: vi.fn() }));
vi.mock('../../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/projects.js')>('../../../../src/lib/projects.js');
  return { ...actual, findProjectByPath: projectsMocks.findProjectByPath };
});

let testRoot: string;
let testHome: string;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    },
  });
}

function gitAt(cwd: string, args: string[], isoDate: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: isoDate,
      GIT_COMMITTER_DATE: isoDate,
    },
  });
}

function createRepo(name: string, relativePath: string, content: string): string {
  const repo = join(testRoot, name);
  const filePath = join(repo, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  git(repo, ['init', '--quiet']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeFileSync(filePath, content);
  git(repo, ['add', relativePath]);
  git(repo, ['commit', '--quiet', '-m', 'initial']);
  return repo;
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'pan-2844-conversation-diffs-'));
  testHome = join(testRoot, 'home');
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
  projectsMocks.findProjectByPath.mockReset();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testRoot, { recursive: true, force: true });
});

describe('getConversationDiffTurn', () => {
  it('returns the patch for a tracked edit in a different repository than the conversation cwd', async () => {
    const cwdRepo = createRepo('cwd-repo', 'README.md', 'cwd repo\n');
    const cwdFile = join(cwdRepo, 'README.md');
    const externalRepo = createRepo('state-repo', 'drafts/pan-2842.md', '# Draft\n');
    const externalFile = join(externalRepo, 'drafts/pan-2842.md');
    const sessionFile = join(testRoot, 'session.jsonl');
    writeFileSync(sessionFile, '');

    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationDiffFull, getConversationDiffTurn } = await import(
      '../../../../src/lib/overdeck/conversation-diffs.js'
    );
    createConversation({ name: 'cross-repo', tmuxSession: 'conv-cross-repo', cwd: cwdRepo });
    writeFileSync(cwdFile, 'cwd repo\nlocal change\n');
    writeFileSync(externalFile, '# Draft\n\nExternal change\n');

    const deps = {
      resolveSessionFile: async () => sessionFile,
      getCachedMessages: async () => ({
        messages: [{ role: 'assistant' as const, id: 'assistant-1', createdAt: new Date().toISOString() }],
        fileEditsByAssistantId: new Map([
          ['assistant-1', [{ filePath: cwdFile }, { filePath: externalFile }]],
        ]),
      }),
    };
    const result = await getConversationDiffTurn(
      'cross-repo',
      'conv-turn-assistant-1',
      'drafts/pan-2842.md',
      deps,
    );

    expect(result.status).toBeUndefined();
    expect(result.body).toMatchObject({ turnId: 'conv-turn-assistant-1' });
    const diff = (result.body as { diff: string }).diff;
    expect(diff).toContain('diff --git a/drafts/pan-2842.md b/drafts/pan-2842.md');
    expect(diff).toContain('+External change');

    const combinedResult = await getConversationDiffTurn(
      'cross-repo',
      'conv-turn-assistant-1',
      undefined,
      deps,
    );
    const combinedDiff = (combinedResult.body as { diff: string }).diff;
    expect(combinedDiff).toContain('diff --git a/README.md b/README.md');
    expect(combinedDiff).toContain('diff --git a/drafts/pan-2842.md b/drafts/pan-2842.md');

    const fullResult = await getConversationDiffFull('cross-repo', undefined, deps);
    const fullDiff = (fullResult.body as { diff: string }).diff;
    expect(fullDiff).toContain('diff --git a/README.md b/README.md');
    expect(fullDiff).toContain('diff --git a/drafts/pan-2842.md b/drafts/pan-2842.md');
    expect(fullDiff).toContain('+External change');
    const fullFiles = (fullResult.body as { files: Array<{ path: string }> }).files;
    expect(fullFiles.map((f) => f.path)).toContain('drafts/pan-2842.md');
  });
});

describe('getConversationDiffVsMain', () => {
  beforeEach(() => {
    projectsMocks.findProjectByPath.mockReturnValue({ workspace: { default_branch: 'trunk' } });
  });

  function createBranchedRepo(name: string): string {
    const repo = join(testRoot, name);
    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '--quiet']);
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '--quiet', '-m', 'initial']);
    git(repo, ['checkout', '--quiet', '-b', 'feature']);
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git(repo, ['add', 'b.txt']);
    git(repo, ['commit', '--quiet', '-m', 'add b.txt']);
    return repo;
  }

  it('returns baseBranch, baseRef, and the feature-branch files, with no turnId key', async () => {
    const repo = createBranchedRepo('vs-main-repo');
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationDiffVsMain } = await import('../../../../src/lib/overdeck/conversation-diffs.js');
    createConversation({ name: 'vs-main-conv', tmuxSession: 'conv-vs-main-conv', cwd: repo });

    const result = await getConversationDiffVsMain('vs-main-conv', undefined);

    expect(result.status).toBeUndefined();
    expect(result.body).toMatchObject({ repoRoot: repo, baseBranch: 'trunk', baseRef: 'trunk' });
    expect((result.body as { files: Array<{ path: string }> }).files.map((f) => f.path)).toEqual(['b.txt']);
    expect(result.body).not.toHaveProperty('turnId');
  });

  it('includes a scoped diff when fileFilter is given', async () => {
    const repo = createBranchedRepo('vs-main-repo-filter');
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationDiffVsMain } = await import('../../../../src/lib/overdeck/conversation-diffs.js');
    createConversation({ name: 'vs-main-conv-filter', tmuxSession: 'conv-vs-main-conv-filter', cwd: repo });

    const result = await getConversationDiffVsMain('vs-main-conv-filter', 'b.txt');

    expect((result.body as { diff: string }).diff).toContain('+++ b/b.txt');
  });

  it('resolves repoRoot to the repository top level when the conversation cwd is a subdirectory', async () => {
    const repo = createBranchedRepo('vs-main-repo-subdir');
    const subdir = join(repo, 'nested');
    mkdirSync(subdir, { recursive: true });
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationDiffVsMain } = await import('../../../../src/lib/overdeck/conversation-diffs.js');
    createConversation({ name: 'vs-main-conv-subdir', tmuxSession: 'conv-vs-main-conv-subdir', cwd: subdir });

    const result = await getConversationDiffVsMain('vs-main-conv-subdir', undefined);

    expect((result.body as { repoRoot: string }).repoRoot).toBe(repo);
  });

  it('returns a null repoRoot/baseRef and no files when the cwd is not a repository', async () => {
    const plainDir = join(testRoot, 'not-a-repo');
    mkdirSync(plainDir, { recursive: true });
    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationDiffVsMain } = await import('../../../../src/lib/overdeck/conversation-diffs.js');
    createConversation({ name: 'vs-main-conv-not-repo', tmuxSession: 'conv-vs-main-conv-not-repo', cwd: plainDir });

    const result = await getConversationDiffVsMain('vs-main-conv-not-repo', undefined);

    expect(result.body).toMatchObject({ repoRoot: null, baseRef: null, files: [] });
  });

  it('returns 404 for an unknown conversation name', async () => {
    const { getConversationDiffVsMain } = await import('../../../../src/lib/overdeck/conversation-diffs.js');

    const result = await getConversationDiffVsMain('does-not-exist', undefined);

    expect(result.status).toBe(404);
  });
});

describe('getConversationDiffFull (PAN-4501: zero-turn files)', () => {
  const FUTURE_DATE = new Date(Date.now() + 86_400_000).toISOString();

  it('returns the uncommitted and post-start committed files with a non-empty diff when there are no edit turns', async () => {
    const repo = createRepo('full-files-repo', 'a.txt', 'a\n');
    const sessionFile = join(testRoot, 'session-full.jsonl');
    writeFileSync(sessionFile, '');

    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationDiffFull } = await import('../../../../src/lib/overdeck/conversation-diffs.js');
    createConversation({ name: 'full-files', tmuxSession: 'conv-full-files', cwd: repo });

    writeFileSync(join(repo, 'a.txt'), 'a\nuncommitted\n');
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    git(repo, ['add', 'c.txt']);
    gitAt(repo, ['commit', '--quiet', '-m', 'add c.txt'], FUTURE_DATE);

    const deps = {
      resolveSessionFile: async () => sessionFile,
      getCachedMessages: async () => ({ messages: [], fileEditsByAssistantId: new Map() }),
    };

    const resultFull = await getConversationDiffFull('full-files', undefined, deps);

    const files = (resultFull.body as { files: Array<{ path: string }> }).files;
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'c.txt']);
    const diff = (resultFull.body as { diff: string }).diff;
    expect(diff.length).toBeGreaterThan(0);
  });

  it('scopes the diff to fileFilter while files still lists every changed path', async () => {
    const repo = createRepo('full-files-repo-filter', 'a.txt', 'a\n');
    const sessionFile = join(testRoot, 'session-full-filter.jsonl');
    writeFileSync(sessionFile, '');

    const { createConversation } = await import('../../../../src/lib/overdeck/conversations.js');
    const { getConversationDiffFull } = await import('../../../../src/lib/overdeck/conversation-diffs.js');
    createConversation({ name: 'full-files-filter', tmuxSession: 'conv-full-files-filter', cwd: repo });

    writeFileSync(join(repo, 'a.txt'), 'a\nuncommitted\n');
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    git(repo, ['add', 'c.txt']);
    gitAt(repo, ['commit', '--quiet', '-m', 'add c.txt'], FUTURE_DATE);

    const deps = {
      resolveSessionFile: async () => sessionFile,
      getCachedMessages: async () => ({ messages: [], fileEditsByAssistantId: new Map() }),
    };

    const resultFiltered = await getConversationDiffFull('full-files-filter', 'a.txt', deps);

    const diff = (resultFiltered.body as { diff: string }).diff;
    expect(diff).toContain('a.txt');
    expect(diff).not.toContain('c.txt');
    const files = (resultFiltered.body as { files: Array<{ path: string }> }).files;
    expect(files.map((f) => f.path)).toEqual(['a.txt', 'c.txt']);
  });
});
