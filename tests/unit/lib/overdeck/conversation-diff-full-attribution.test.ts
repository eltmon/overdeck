/**
 * PAN-5408 acceptance test: for the cwd repo, GET /diffs/full's All turns
 * list is exactly the conversation's attributed files (the
 * GET …/changes?scope=conversation set) — never the whole repository's
 * changes since the conversation started.
 *
 * The file gets its own Overdeck home (set before any module loads), and git
 * runs isolated from the session running the tests: the git-guard PATH
 * segments are dropped and the agent/conversation ids deleted, so fixture
 * commits carry only the trailers the test writes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isolated = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const saved = {
    OVERDECK_HOME: process.env.OVERDECK_HOME,
    PATH: process.env.PATH,
    OVERDECK_AGENT_ID: process.env.OVERDECK_AGENT_ID,
    OVERDECK_CONVERSATION: process.env.OVERDECK_CONVERSATION,
  };
  const overdeckHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-5408-diff-full-home-'));
  process.env.OVERDECK_HOME = overdeckHome;
  process.env.PATH = (process.env.PATH ?? '').split(':').filter((s) => !s.endsWith('/git-guard')).join(':');
  delete process.env.OVERDECK_AGENT_ID;
  delete process.env.OVERDECK_CONVERSATION;
  return { saved, overdeckHome };
});

import type { ConversationChanges } from '@overdeck/contracts';

import { getConversationChanges, resetConversationChangesCachesForTests } from '../../../../src/lib/overdeck/conversation-changes.js';
import { getConversationDiffFull } from '../../../../src/lib/overdeck/conversation-diffs.js';
import { createConversation } from '../../../../src/lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../../src/lib/overdeck/infra.js';

let testRoot: string;

function git(cwd: string, args: string[], isoDate: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
}

afterAll(() => {
  closeOverdeckDatabase();
  for (const [key, value] of Object.entries(isolated.saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(isolated.overdeckHome, { recursive: true, force: true });
});

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'pan-5408-diff-full-'));
  resetConversationChangesCachesForTests();
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('getConversationDiffFull attribution (PAN-5408)', () => {
  it('lists exactly the conversation\'s attributed files for the cwd repo', async () => {
    const INITIAL_DATE = '2020-01-01T00:00:00Z';
    const FUTURE_DATE = new Date(Date.now() + 86_400_000).toISOString();
    const repo = join(testRoot, 'repo');
    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '--quiet'], INITIAL_DATE);
    git(repo, ['config', 'user.email', 'test@example.com'], INITIAL_DATE);
    git(repo, ['config', 'user.name', 'Test User'], INITIAL_DATE);
    writeFileSync(join(repo, 'mine-edited.txt'), 'mine\n');
    writeFileSync(join(repo, 'other-dirty.txt'), 'other\n');
    writeFileSync(join(repo, 'README.md'), '# readme\n');
    git(repo, ['add', '.'], INITIAL_DATE);
    git(repo, ['commit', '--quiet', '-m', 'initial'], INITIAL_DATE);
    const initialSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();

    createConversation({ name: 'attr-full', tmuxSession: 'conv-attr-full', cwd: repo });

    // Commit A: mine-committed.txt, trailer-attributed to this conversation.
    writeFileSync(join(repo, 'mine-committed.txt'), 'mine committed\n');
    git(repo, ['add', 'mine-committed.txt'], FUTURE_DATE);
    git(repo, ['commit', '--quiet', '-m', 'add mine-committed', '-m', 'Overdeck-Conversation: conv-attr-full'], FUTURE_DATE);

    // Commit B: unattributed changes by other agents in the same checkout.
    mkdirSync(join(repo, '.pan', 'backlog'), { recursive: true });
    writeFileSync(join(repo, 'other-1.txt'), 'other 1\n');
    writeFileSync(join(repo, 'other-2.txt'), 'other 2\n');
    writeFileSync(join(repo, '.pan', 'backlog', 'sequence.md'), '# sequence\n');
    git(repo, ['add', 'other-1.txt', 'other-2.txt', '.pan/backlog/sequence.md'], FUTURE_DATE);
    git(repo, ['commit', '--quiet', '-m', 'unrelated changes'], FUTURE_DATE);

    // Uncommitted: mine-edited.txt has an edit record; other-dirty.txt does not.
    writeFileSync(join(repo, 'mine-edited.txt'), 'mine\nedited\n');
    writeFileSync(join(repo, 'other-dirty.txt'), 'other\ndirty\n');

    const sessionFile = join(testRoot, 'session.jsonl');
    writeFileSync(sessionFile, '{}\n');

    const parsed = {
      messages: [{ role: 'assistant' as const, id: 'a1', createdAt: new Date().toISOString() }],
      workLog: [],
      fileEditsByAssistantId: new Map([['a1', [{ filePath: join(repo, 'mine-edited.txt') }]]]),
    };
    const changesDeps = {
      resolveSessionFile: async () => sessionFile,
      getCachedMessages: async () => parsed,
      peekCachedMessages: () => null,
      listConversations: () => [],
      now: Date.now,
    };
    const fullDeps = {
      resolveSessionFile: changesDeps.resolveSessionFile,
      getCachedMessages: changesDeps.getCachedMessages,
      conversationChanges: async (n: string) =>
        (await getConversationChanges(n, { scope: 'conversation' }, changesDeps)).body as ConversationChanges,
    };

    // The branch diff since the conversation started lists far more than the
    // conversation's own changes — that is the defect this test guards against.
    const branchDiffPaths = execFileSync('git', ['diff', '--name-only', initialSha], { cwd: repo, encoding: 'utf-8' })
      .split('\n')
      .filter((p) => p.trim() !== '');
    expect(branchDiffPaths.length).toBeGreaterThanOrEqual(6);

    const changesResult = await getConversationChanges('attr-full', { scope: 'conversation' }, changesDeps);
    expect(changesResult.status).toBe(200);
    const attributedPaths = [
      ...(changesResult.body as ConversationChanges).commits.flatMap((c) => c.files.map((f) => f.path)),
      ...(changesResult.body as ConversationChanges).uncommitted.map((f) => f.path),
    ].sort();
    expect(attributedPaths).toEqual(['mine-committed.txt', 'mine-edited.txt']);

    const fullResult = await getConversationDiffFull('attr-full', undefined, fullDeps);
    const files = (fullResult.body as { files: Array<{ path: string }> }).files;
    expect(files.map((f) => f.path)).toEqual(['mine-committed.txt', 'mine-edited.txt']);

    const diff = (fullResult.body as { diff: string }).diff;
    expect(diff).toContain('mine-committed.txt');
    expect(diff).toContain('mine-edited.txt');
    for (const unattributed of ['other-1.txt', 'other-2.txt', 'other-dirty.txt', '.pan/backlog/sequence.md']) {
      expect(diff).not.toContain(unattributed);
    }
  });

  it('renders an untracked attributed file as a new-file patch (FR-5)', async () => {
    const INITIAL_DATE = '2020-01-01T00:00:00Z';
    const repo = join(testRoot, 'repo-untracked');
    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '--quiet'], INITIAL_DATE);
    git(repo, ['config', 'user.email', 'test@example.com'], INITIAL_DATE);
    git(repo, ['config', 'user.name', 'Test User'], INITIAL_DATE);
    writeFileSync(join(repo, 'README.md'), '# readme\n');
    git(repo, ['add', '.'], INITIAL_DATE);
    git(repo, ['commit', '--quiet', '-m', 'initial'], INITIAL_DATE);

    createConversation({ name: 'attr-untracked', tmuxSession: 'conv-attr-untracked', cwd: repo });

    // mine-new.txt is untracked but recorded as edited; stray.txt is untracked and unrecorded.
    writeFileSync(join(repo, 'mine-new.txt'), 'new line\n');
    writeFileSync(join(repo, 'stray.txt'), 'stray\n');

    const sessionFile = join(testRoot, 'session-untracked.jsonl');
    writeFileSync(sessionFile, '{}\n');

    const parsed = {
      messages: [{ role: 'assistant' as const, id: 'a1', createdAt: new Date().toISOString() }],
      workLog: [],
      fileEditsByAssistantId: new Map([['a1', [{ filePath: join(repo, 'mine-new.txt') }]]]),
    };
    const changesDeps = {
      resolveSessionFile: async () => sessionFile,
      getCachedMessages: async () => parsed,
      peekCachedMessages: () => null,
      listConversations: () => [],
      now: Date.now,
    };
    const fullDeps = {
      resolveSessionFile: changesDeps.resolveSessionFile,
      getCachedMessages: changesDeps.getCachedMessages,
      conversationChanges: async (n: string) =>
        (await getConversationChanges(n, { scope: 'conversation' }, changesDeps)).body as ConversationChanges,
    };

    const fullResult = await getConversationDiffFull('attr-untracked', undefined, fullDeps);
    const files = (fullResult.body as { files: Array<{ path: string }> }).files.map((f) => f.path);
    expect(files).toContain('mine-new.txt');
    expect(files).not.toContain('stray.txt');

    const fileResult = await getConversationDiffFull('attr-untracked', 'mine-new.txt', fullDeps);
    const diff = (fileResult.body as { diff: string }).diff;
    expect(diff).toContain('+++ b/mine-new.txt');
    expect(diff).toContain('+new line');
    expect(diff).not.toContain('stray.txt');
  });
});

describe('getConversationDiffFull own changes per file (PAN-5418)', () => {
  const INITIAL_DATE = '2020-01-01T00:00:00Z';
  const minutesAfterFuture = (minutes: number): string =>
    new Date(Date.now() + 86_400_000 + minutes * 60_000).toISOString();
  const foreignLines = (count: number): string => Array.from({ length: count }, (_, i) => `foreign-${i}\n`).join('');

  /** A repo with x.txt committed in 2020 and a conversation created on it; returns the repo and full-diff deps. */
  function setup(name: string): { repo: string; fullDeps: Parameters<typeof getConversationDiffFull>[2] } {
    const repo = join(testRoot, name);
    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '--quiet'], INITIAL_DATE);
    git(repo, ['config', 'user.email', 'test@example.com'], INITIAL_DATE);
    git(repo, ['config', 'user.name', 'Test User'], INITIAL_DATE);
    writeFileSync(join(repo, 'x.txt'), 'old\nkeep\n');
    git(repo, ['add', '.'], INITIAL_DATE);
    git(repo, ['commit', '--quiet', '-m', 'initial'], INITIAL_DATE);
    createConversation({ name, tmuxSession: `conv-${name}`, cwd: repo });

    const sessionFile = join(testRoot, `${name}.jsonl`);
    writeFileSync(sessionFile, '{}\n');
    const parsed = {
      messages: [{ role: 'assistant' as const, id: 'a1', createdAt: new Date().toISOString() }],
      workLog: [],
      fileEditsByAssistantId: new Map<string, Array<{ filePath: string }>>(),
    };
    const changesDeps = {
      resolveSessionFile: async () => sessionFile,
      getCachedMessages: async () => parsed,
      peekCachedMessages: () => null,
      listConversations: () => [],
      now: Date.now,
    };
    return {
      repo,
      fullDeps: {
        resolveSessionFile: changesDeps.resolveSessionFile,
        getCachedMessages: changesDeps.getCachedMessages,
        conversationChanges: async (n: string) =>
          (await getConversationChanges(n, { scope: 'conversation' }, changesDeps)).body as ConversationChanges,
      },
    };
  }

  function commitX(repo: string, content: string, isoDate: string, subject: string, trailer?: string): string {
    writeFileSync(join(repo, 'x.txt'), content);
    git(repo, ['add', 'x.txt'], isoDate);
    git(repo, ['commit', '--quiet', '-m', subject, ...(trailer ? ['-m', trailer] : [])], isoDate);
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf-8' }).trim();
  }

  it('shows only the conversation\'s one-line change when a later foreign commit adds 50 lines (PAN-5418)', async () => {
    const { repo, fullDeps } = setup('own-combined');
    commitX(repo, 'new\nkeep\n', minutesAfterFuture(1), 'own change', 'Overdeck-Conversation: conv-own-combined');
    commitX(repo, `new\nkeep\n${foreignLines(50)}`, minutesAfterFuture(2), 'foreign 50 lines');

    const fullResult = await getConversationDiffFull('own-combined', 'x.txt', fullDeps);
    const body = fullResult.body as { diff: string; files: Array<{ path: string; additions: number; deletions: number }> };
    expect(body.files).toEqual([expect.objectContaining({ path: 'x.txt', additions: 1, deletions: 1 })]);
    expect(body.diff).toContain('+new');
    expect(body.diff).not.toContain('foreign-');
  });

  it('renders commit sections when a foreign commit sits between two conversation commits (PAN-5418)', async () => {
    const { repo, fullDeps } = setup('own-sections');
    const trailer = 'Overdeck-Conversation: conv-own-sections';
    const older = commitX(repo, 'first\nkeep\n', minutesAfterFuture(1), 'own first', trailer);
    commitX(repo, `first\nkeep\n${foreignLines(5)}`, minutesAfterFuture(2), 'foreign between');
    const newer = commitX(repo, `first\nsecond\n${foreignLines(5)}`, minutesAfterFuture(3), 'own second', trailer);

    const fullResult = await getConversationDiffFull('own-sections', undefined, fullDeps);
    const body = fullResult.body as { diff: string; files: Array<{ path: string; additions: number; deletions: number }> };
    expect(body.files).toEqual([expect.objectContaining({ path: 'x.txt', additions: 2, deletions: 2 })]);
    const olderAt = body.diff.indexOf(`From ${older} `);
    const newerAt = body.diff.indexOf(`From ${newer} `);
    expect(olderAt).toBeGreaterThanOrEqual(0);
    expect(newerAt).toBeGreaterThan(olderAt);
    expect(body.diff).not.toMatch(/^\+foreign-/m);
  });
});
