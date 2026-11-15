/**
 * PAN-5288 WI-5: getConversationChanges on the shared workflow fixture
 * (PAN-5287 §6.9) — scopes, totals, the not-a-repository response, the 30 s
 * cache and the totals map — plus the server-side rootId rules.
 *
 * The file gets its own Overdeck home (set before any module loads), and git
 * runs isolated from the session running the tests: the git-guard PATH
 * segments are dropped and the agent/conversation ids deleted, so fixture
 * commits carry only the trailers the fixture writes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const overdeckHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-5288-changes-home-'));
  process.env.OVERDECK_HOME = overdeckHome;
  process.env.PATH = (process.env.PATH ?? '').split(':').filter((s) => !s.endsWith('/git-guard')).join(':');
  delete process.env.OVERDECK_AGENT_ID;
  delete process.env.OVERDECK_CONVERSATION;
  return { saved, overdeckHome };
});

import type { ConversationChanges } from '@overdeck/contracts';

import { seedWorkflowFixture, type SeedResult } from '../../../../scripts/dev/seed-workflow-fixture.js';
import {
  getChangeTotals,
  getConversationChanges,
  resetConversationChangesCachesForTests,
  rootIdForConversationRow,
  type ConversationChangesDependencies,
} from '../../../../src/lib/overdeck/conversation-changes.js';
import type { ConversationDiffParseResult } from '../../../../src/lib/overdeck/conversation-diffs.js';
import { getCachedMessages, peekCachedMessages } from '../../../../src/lib/overdeck/conversation-reads.js';
import { createConversation, listConversations, type LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';
import { closeOverdeckDatabase } from '../../../../src/lib/overdeck/infra.js';
import { claudeProjectDir, claudeProjectsRoot } from '../../../../src/lib/runtimes/storage/claude-code.js';

let root: string;
let home: string;
let seed: SeedResult;
let clock = 0;

function transcriptPath(conv: LegacyConversation): string | null {
  return conv.claudeSessionId
    ? join(claudeProjectDir(seed.repoPath, claudeProjectsRoot(home)), `${conv.claudeSessionId}.jsonl`)
    : null;
}

function deps(overrides: Partial<ConversationChangesDependencies> = {}): ConversationChangesDependencies {
  return {
    resolveSessionFile: async (conv) => transcriptPath(conv),
    getCachedMessages,
    peekCachedMessages,
    listConversations: () => listConversations(),
    now: () => clock,
    ...overrides,
  };
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: seed.repoPath,
    env: { ...process.env, OVERDECK_PAN_GIT_OP: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgSign', GIT_CONFIG_VALUE_0: 'false' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function body(result: { status: number; body: unknown }): ConversationChanges {
  expect(result.status).toBe(200);
  return result.body as ConversationChanges;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'pan-5288-changes-'));
  home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const now = new Date();
  now.setHours(15, 0, 0, 0);
  seed = await seedWorkflowFixture({ root: join(root, 'fixture'), home, now });
  // Warm fixture-2's parse: other conversations are named only from cached parses.
  const fixture2 = listConversations().find((c) => c.name === 'fixture-2')!;
  await getCachedMessages(transcriptPath(fixture2)!, false);
});

afterAll(() => {
  closeOverdeckDatabase();
  for (const [key, value] of Object.entries(isolated.saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(isolated.overdeckHome, { recursive: true, force: true });
});

beforeEach(() => {
  resetConversationChangesCachesForTests();
  clock = Date.now();
});

describe('getConversationChanges on the workflow fixture', () => {
  it('lists the tool-output and trailer commits and the shared uncommitted file with line attribution (AC-A)', async () => {
    const changes = body(await getConversationChanges('fixture-1', { scope: 'conversation' }, deps()));

    expect(changes).toMatchObject({
      conversation: 'fixture-1',
      repoRoot: seed.repoPath,
      rootId: 'project:workflow-fixture',
      branch: 'main',
      scope: 'conversation',
    });
    expect(changes.commits.map((c) => [c.sha, c.pushed, c.attribution])).toEqual([
      [seed.shas.trailer, false, 'trailer'],
      [seed.shas.preTrailer, true, 'tool-output'],
    ]);
    expect(changes.uncommitted).toHaveLength(1);
    expect(changes.uncommitted[0]).toMatchObject({
      path: 'docs/shared.md',
      status: 'M',
      additions: 6,
      attribution: 'lines',
      otherLines: 2,
      otherConversations: [{ name: 'fixture-2', title: 'Second fixture conversation' }],
    });
    expect(changes.totals).toEqual({
      files: 2,
      additions: 3 + 1 + 6,
      deletions: 1,
      commitsPushed: 1,
      commitsLocal: 1,
      uncommittedFiles: 1,
    });
    expect(getChangeTotals('fixture-1')?.totals).toEqual({
      files: 2, additions: 10, deletions: 1, uncommittedFiles: 1, commitsLocal: 1,
    });
  });

  it('scope uncommitted returns no commits and totals over the files only', async () => {
    const changes = body(await getConversationChanges('fixture-1', { scope: 'uncommitted' }, deps()));
    expect(changes.scope).toBe('uncommitted');
    expect(changes.commits).toEqual([]);
    expect(changes.uncommitted.map((f) => f.path)).toEqual(['docs/shared.md']);
    expect(changes.totals).toEqual({ files: 1, additions: 6, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 1 });
  });

  it("scope main lists today's commits on HEAD and marks this conversation's own", async () => {
    const changes = body(await getConversationChanges('fixture-1', { scope: 'main' }, deps()));
    expect(changes.scope).toBe('main');
    expect(changes.uncommitted).toEqual([]);
    expect(changes.commits.map((c) => [c.sha, c.attribution, c.by?.isThisConversation])).toEqual([
      [seed.shas.trailer, 'trailer', true],
      [seed.shas.preTrailer, 'tool-output', true],
      [seed.shas.initial, 'trailer', false],
    ]);
    expect(changes.commits[0]?.by).toMatchObject({ kind: 'conversation', id: 'fixture-1', title: 'Fixture conversation' });
    expect(changes.commits[1]?.by).toEqual({ kind: 'conversation', id: 'fixture-1', title: 'Fixture conversation', isThisConversation: true });
    expect(changes.commits[2]?.by).toEqual({ kind: 'unattributed', isThisConversation: false });
    expect(changes.totals.commitsLocal).toBe(1);
    expect(changes.totals.commitsPushed).toBe(2);
  });

  it('scope turn filters by the requested turn, accepts the conv-turn- prefix, and defaults to the last turn with changes', async () => {
    const sessionFile = join(root, 'turns.jsonl');
    writeFileSync(sessionFile, '{}\n');
    createConversation({ name: 'turns-conv', tmuxSession: 'conv-turns-conv', cwd: seed.repoPath });
    const short = seed.shas.preTrailer.slice(0, 7);
    const parsed: ConversationDiffParseResult = {
      messages: [
        { role: 'user', id: 'u1', createdAt: '2026-11-14T10:00:00Z' },
        { role: 'assistant', id: 'a1', createdAt: '2026-11-14T10:01:00Z' },
        { role: 'user', id: 'u2', createdAt: '2026-11-14T10:10:00Z' },
        { role: 'assistant', id: 'a2', createdAt: '2026-11-14T10:11:00Z' },
      ],
      workLog: [
        {
          id: 'w1', createdAt: '2026-11-14T10:02:00Z', label: 'Bash', toolTitle: 'Bash', tone: 'tool',
          toolInput: { command: 'git commit -m "feat: add app entry"' }, result: `[main ${short}] feat: add app entry`,
        },
      ],
      fileEditsByAssistantId: new Map([['a2', [{ filePath: join(seed.repoPath, 'docs/shared.md') }]]]),
    };
    const turnDeps = deps({ resolveSessionFile: async () => sessionFile, getCachedMessages: async () => parsed });

    const first = body(await getConversationChanges('turns-conv', { scope: 'turn', turnId: 'conv-turn-a1' }, turnDeps));
    expect(first).toMatchObject({ scope: 'turn', turnId: 'a1' });
    expect(first.commits.map((c) => c.sha)).toEqual([seed.shas.preTrailer]);
    expect(first.uncommitted).toEqual([]);
    expect(first.totals).toMatchObject({ commitsPushed: 1, commitsLocal: 0, uncommittedFiles: 0, files: 1 });

    const last = body(await getConversationChanges('turns-conv', { scope: 'turn' }, turnDeps));
    expect(last.turnId).toBe('a2');
    expect(last.commits).toEqual([]);
    expect(last.uncommitted.map((f) => [f.path, f.turnIds])).toEqual([['docs/shared.md', ['a2']]]);
    expect(last.totals).toMatchObject({ uncommittedFiles: 1, files: 1, commitsPushed: 0 });
  });

  it('returns 404 for an unknown name, 400 for an unknown scope, and an empty 200 outside any repository', async () => {
    expect((await getConversationChanges('does-not-exist', { scope: 'conversation' }, deps())).status).toBe(404);
    const bogus = await getConversationChanges('fixture-1', { scope: 'bogus' as 'conversation' }, deps());
    expect(bogus).toEqual({ status: 400, body: { error: 'Invalid scope' } });

    const outside = join(root, 'not-a-repo');
    mkdirSync(outside, { recursive: true });
    createConversation({ name: 'no-repo', tmuxSession: 'conv-no-repo', cwd: outside });
    const empty = body(await getConversationChanges('no-repo', { scope: 'conversation' }, deps()));
    expect(empty).toMatchObject({ conversation: 'no-repo', repoRoot: outside, branch: null, rootId: null, commits: [], uncommitted: [] });
    expect(empty.totals).toEqual({ files: 0, additions: 0, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 0 });
  });

  // Runs last in this block: it adds a commit to the fixture repository.
  it('serves the cached object within 30 s and recomputes after 31 s or a HEAD change', async () => {
    const first = body(await getConversationChanges('fixture-1', { scope: 'conversation' }, deps()));
    const second = body(await getConversationChanges('fixture-1', { scope: 'conversation' }, deps()));
    expect(second).toBe(first);

    clock += 31_000;
    const third = body(await getConversationChanges('fixture-1', { scope: 'conversation' }, deps()));
    expect(third).not.toBe(first);
    expect(third).toEqual(first);
    expect(body(await getConversationChanges('fixture-1', { scope: 'conversation' }, deps()))).toBe(third);

    git(['commit', '--quiet', '--allow-empty', '-m', 'unrelated']);
    const fourth = body(await getConversationChanges('fixture-1', { scope: 'conversation' }, deps()));
    expect(fourth).not.toBe(third);
  });
});

describe('rootIdForConversationRow', () => {
  const projects = [
    { key: 'proj', config: { path: '/repos/proj' } },
    { key: 'inner', config: { path: '/repos/proj/packages/inner' } },
  ];
  const row = (fields: Partial<Pick<LegacyConversation, 'origin' | 'issueId' | 'workspaceId' | 'cwd'>>) => ({
    origin: 'local' as const, issueId: null, workspaceId: null, cwd: '/elsewhere', ...fields,
  });

  it('applies the A-D10 rules in order', () => {
    expect(rootIdForConversationRow(row({ issueId: 'pan-12', cwd: '/repos/proj' }), projects)).toBe('issue:PAN-12');
    expect(rootIdForConversationRow(row({ workspaceId: 'ws-1', cwd: '/repos/proj' }), projects)).toBeNull();
    expect(rootIdForConversationRow(row({ cwd: '/repos/proj/workspaces/feature-pan-5288/src' }), projects)).toBe('issue:PAN-5288');
    expect(rootIdForConversationRow(row({ cwd: '/repos/proj/workspaces/scratch' }), projects)).toBeNull();
    expect(rootIdForConversationRow(row({ cwd: '/repos/proj/src/lib' }), projects)).toBe('project:proj');
    expect(rootIdForConversationRow(row({ cwd: '/repos/proj/packages/inner/x' }), projects)).toBe('project:inner');
    expect(rootIdForConversationRow(row({ cwd: '/elsewhere' }), projects)).toBeNull();
    expect(rootIdForConversationRow(row({ origin: 'vault', issueId: 'PAN-1' }), projects)).toBeNull();
  });
});
