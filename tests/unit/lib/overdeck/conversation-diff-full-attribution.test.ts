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
});
