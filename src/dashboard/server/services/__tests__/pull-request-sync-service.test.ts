import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// PAN-3822: the pull-request sync sweep links PRs to conversations by branch
// and keeps their snapshots fresh. Real temp overdeck.db; the forge listing and
// the git branch read are mocked.

const TEST_HOME = join(tmpdir(), `pr-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
process.env.HOME = TEST_HOME;

const REPO_PATH = join(TEST_HOME, 'projects', 'overdeck');

const emitOnlyMock = vi.fn();
vi.mock('../../event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: emitOnlyMock })),
}));
vi.mock('../dashboard-poll-snapshots.js', () => ({
  getConversationLedgerCostsSnapshot: vi.fn(async () => []),
}));

const branchByCwd = new Map<string, string | null>();
vi.mock('../git-info.js', () => ({
  resolveConversationGitInfo: vi.fn(async (cwd: string) => ({ branch: branchByCwd.get(cwd) ?? null, isWorktree: false })),
}));

type Row = Record<string, unknown>;
let prRows: Row[] = [];
const listRepoPullRequestsMock = vi.fn(async (_projectPath: string) => prRows);
vi.mock('../../../../lib/overdeck/derived-issue-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/overdeck/derived-issue-state.js')>();
  return {
    ...actual,
    listRepoPullRequests: (projectPath: string) => listRepoPullRequestsMock(projectPath),
    forgeForProject: () => 'github' as const,
  };
});

const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
const { closeOverdeckDatabase, getOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
const {
  linkConversationPullRequest,
  listConversationPullRequests,
  setPullRequestLinkSnapshot,
} = await import('../../../../lib/overdeck/conversation-pull-requests.js');
const { getEnrichedConversationList, invalidateConversationListEnrichmentCache } = await import('../../../../lib/overdeck/conversation-list.js');
const {
  PR_SYNC_BOOT_DELAY_MS,
  PR_SYNC_INTERVAL_MS,
  PR_SYNC_SLOW_INTERVAL_MS,
  githubPullRequestKeyFromUrl,
  runPullRequestSyncOnce,
  snapshotFromGhRow,
  startPullRequestSyncService,
  stopPullRequestSyncService,
} = await import('../pull-request-sync-service.js');

function pr(number: number, headRefName: string, extra: Row = {}): Row {
  return {
    number,
    url: `https://github.com/Eltmon/Overdeck/pull/${number}`,
    title: `PR ${number}`,
    state: 'OPEN',
    mergedAt: null,
    mergeable: 'MERGEABLE',
    headRefName,
    baseRefName: 'main',
    isDraft: false,
    reviewDecision: null,
    reviewRequests: [],
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    updatedAt: '2026-09-20T00:00:00Z',
    closedAt: null,
    author: { login: 'eltmon' },
    ...extra,
  };
}

let seq = 0;
function conversation(branch: string | null, opts: { name?: string; issueId?: string } = {}): string {
  seq += 1;
  const name = opts.name ?? `pr-sync-conv-${seq}`;
  const cwd = join(REPO_PATH, `wt-${seq}`);
  branchByCwd.set(cwd, branch);
  createConversation({ name, tmuxSession: `conv-${name}`, cwd, issueId: opts.issueId, title: name });
  return name;
}

beforeAll(() => {
  mkdirSync(REPO_PATH, { recursive: true });
  writeFileSync(
    join(TEST_HOME, 'projects.yaml'),
    ['projects:', '  overdeck:', '    name: Overdeck', `    path: ${REPO_PATH}`, ''].join('\n'),
    'utf-8',
  );
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  closeOverdeckDatabase();
  getOverdeckDatabase().exec('DELETE FROM conversation_pull_requests; DELETE FROM conversations;');
  branchByCwd.clear();
  prRows = [];
  listRepoPullRequestsMock.mockClear();
  emitOnlyMock.mockClear();
});

afterEach(() => {
  stopPullRequestSyncService();
  vi.useRealTimers();
});

describe('githubPullRequestKeyFromUrl', () => {
  it('lower-cases host and repository and rebuilds the canonical URL', () => {
    expect(githubPullRequestKeyFromUrl('https://GitHub.com/Eltmon/Overdeck/pull/42/files?x=1')).toEqual({
      host: 'github.com', repository: 'eltmon/overdeck', number: 42, url: 'https://github.com/eltmon/overdeck/pull/42',
    });
    expect(githubPullRequestKeyFromUrl('https://github.com/eltmon/overdeck/issues/42')).toBeNull();
  });
});

describe('runPullRequestSyncOnce — branch detection', () => {
  it('links the PR whose head branch equals the conversation branch, and shows it on the list row', async () => {
    const name = conversation('feature/pan-1234');
    prRows = [pr(7, 'feature/pan-1234'), pr(8, 'feature/other')];

    const result = await runPullRequestSyncOnce();

    expect(result.inserted).toBe(1);
    const links = listConversationPullRequests(name);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      host: 'github.com', repository: 'eltmon/overdeck', number: 7, source: 'branch', dismissedAt: null,
      snapshot: expect.objectContaining({ state: 'open', title: 'PR 7', checks: 'green', author: 'eltmon' }),
    });
    expect(emitOnlyMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'conversation.pull_requests_changed',
      payload: expect.objectContaining({ conversationName: name, effective: expect.objectContaining({ number: 7 }) }),
    }));

    invalidateConversationListEnrichmentCache();
    const rows = await getEnrichedConversationList(50, 0) as Array<{ name: string; pullRequest: { number: number } | null }>;
    expect(rows.find((row) => row.name === name)?.pullRequest?.number).toBe(7);
  });

  it('never links a conversation on the default branch', async () => {
    const name = conversation('main');
    prRows = [pr(9, 'main')];

    await runPullRequestSyncOnce();

    expect(listConversationPullRequests(name)).toEqual([]);
  });

  it('falls back to feature/<issue> for an agent conversation whose cwd has no branch', async () => {
    const name = conversation(null, { name: 'agent-pan-55', issueId: 'PAN-55' });
    prRows = [pr(55, 'feature/pan-55')];

    await runPullRequestSyncOnce();

    expect(listConversationPullRequests(name).map((link) => link.number)).toEqual([55]);
  });

  it('does not re-add a dismissed branch link', async () => {
    const name = conversation('feature/pan-2');
    prRows = [pr(2, 'feature/pan-2')];
    await runPullRequestSyncOnce();
    getOverdeckDatabase().prepare('UPDATE conversation_pull_requests SET dismissed_at = ?').run(Date.now());
    emitOnlyMock.mockClear();

    const result = await runPullRequestSyncOnce();

    expect(result.inserted).toBe(0);
    expect(listConversationPullRequests(name)[0]?.dismissedAt).not.toBeNull();
    invalidateConversationListEnrichmentCache();
    const rows = await getEnrichedConversationList(50, 0) as Array<{ name: string; pullRequest: unknown }>;
    expect(rows.find((row) => row.name === name)?.pullRequest).toBeNull();
  });
});

describe('runPullRequestSyncOnce — snapshots', () => {
  it('reads each project listing once per sweep and updates both conversations sharing a PR', async () => {
    const a = conversation('feature/shared');
    const b = conversation('feature/shared');
    prRows = [pr(3, 'feature/shared')];
    await runPullRequestSyncOnce();
    expect(listRepoPullRequestsMock).toHaveBeenCalledTimes(1);
    emitOnlyMock.mockClear();

    prRows = [pr(3, 'feature/shared', { reviewDecision: 'CHANGES_REQUESTED', updatedAt: '2026-09-21T00:00:00Z' })];
    const result = await runPullRequestSyncOnce();

    expect(listRepoPullRequestsMock).toHaveBeenCalledTimes(2);
    expect(result.updated).toBe(2);
    expect(listConversationPullRequests(a)[0]?.snapshot?.reviewState).toBe('changes-requested');
    expect(listConversationPullRequests(b)[0]?.snapshot?.reviewState).toBe('changes-requested');
    expect(emitOnlyMock).toHaveBeenCalledTimes(2);
  });

  it('writes nothing and emits nothing when the PR did not change', async () => {
    conversation('feature/steady');
    prRows = [pr(4, 'feature/steady')];
    await runPullRequestSyncOnce(Date.parse('2026-09-22T00:00:00Z'));
    emitOnlyMock.mockClear();

    const result = await runPullRequestSyncOnce(Date.parse('2026-09-22T00:01:00Z'));

    expect(result).toEqual({ inserted: 0, updated: 0 });
    expect(emitOnlyMock).not.toHaveBeenCalled();
  });

  it('never rewrites a merged snapshot', async () => {
    const name = conversation('feature/done');
    prRows = [pr(5, 'feature/done', { state: 'MERGED', mergedAt: '2026-09-20T01:00:00Z' })];
    await runPullRequestSyncOnce();
    expect(listConversationPullRequests(name)[0]?.snapshot?.state).toBe('merged');

    prRows = [pr(5, 'feature/done', { state: 'MERGED', mergedAt: '2026-09-20T01:00:00Z', title: 'renamed' })];
    const result = await runPullRequestSyncOnce();

    expect(result.updated).toBe(0);
    expect(listConversationPullRequests(name)[0]?.snapshot?.title).toBe('PR 5');
  });
});

describe('runPullRequestSyncOnce — slow lane, fallback, backoff (WI-4)', () => {
  const T0 = Date.parse('2026-09-24T00:00:00Z');
  const MINUTE = 60_000;
  const OUT_OF_PROJECT_CWD = join(TEST_HOME, 'elsewhere');

  function linkExplicitly(name: string, number: number): void {
    linkConversationPullRequest(name, {
      host: 'github.com', repository: 'eltmon/overdeck', number, url: `https://github.com/eltmon/overdeck/pull/${number}`,
    }, 'manual', T0);
  }

  it('re-reads a closed PR only every 15 minutes', async () => {
    const name = conversation('feature/closed');
    prRows = [pr(11, 'feature/closed', { state: 'CLOSED', closedAt: '2026-09-23T00:00:00Z' })];
    await runPullRequestSyncOnce(T0, async () => null);
    expect(listConversationPullRequests(name)[0]?.snapshot?.state).toBe('closed');

    prRows = [pr(11, 'feature/closed', { state: 'CLOSED', closedAt: '2026-09-23T00:00:00Z', title: 'renamed' })];
    expect((await runPullRequestSyncOnce(T0 + MINUTE, async () => null)).updated).toBe(0);
    expect((await runPullRequestSyncOnce(T0 + PR_SYNC_SLOW_INTERVAL_MS - 1, async () => null)).updated).toBe(0);
    expect((await runPullRequestSyncOnce(T0 + PR_SYNC_SLOW_INTERVAL_MS, async () => null)).updated).toBe(1);
    expect(listConversationPullRequests(name)[0]?.snapshot?.title).toBe('renamed');
  });

  it('reads a linked PR missing from the listing with one gh pr view per sweep, even when shared', async () => {
    const a = conversation('feature/a');
    const b = conversation('feature/b');
    linkExplicitly(a, 900);
    linkExplicitly(b, 900);
    prRows = [pr(1, 'feature/unrelated')];
    const read = vi.fn(async () => pr(900, 'feature/old', { title: 'Old PR beyond the listing' }) as never);

    const result = await runPullRequestSyncOnce(T0, read);

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ repository: 'eltmon/overdeck', number: 900 }));
    expect(result.updated).toBe(2);
    expect(listConversationPullRequests(a)[0]?.snapshot?.title).toBe('Old PR beyond the listing');
    expect(emitOnlyMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes links on a conversation outside every GitHub project through the fallback', async () => {
    branchByCwd.set(OUT_OF_PROJECT_CWD, null);
    createConversation({ name: 'outside', tmuxSession: 'conv-outside', cwd: OUT_OF_PROJECT_CWD, title: 'outside' });
    linkExplicitly('outside', 901);
    const read = vi.fn(async () => pr(901, 'x') as never);

    await runPullRequestSyncOnce(T0, read);

    expect(listRepoPullRequestsMock).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(listConversationPullRequests('outside')[0]?.snapshot?.state).toBe('open');
  });

  it('skips a repository for 15 minutes after 3 failed reads in a row', async () => {
    const name = conversation('feature/flaky');
    linkExplicitly(name, 902);
    const read = vi.fn(async () => null);

    for (let sweep = 0; sweep < 3; sweep += 1) await runPullRequestSyncOnce(T0 + sweep * MINUTE, read);
    expect(read).toHaveBeenCalledTimes(3);

    await runPullRequestSyncOnce(T0 + 3 * MINUTE, read);
    await runPullRequestSyncOnce(T0 + 2 * MINUTE + PR_SYNC_SLOW_INTERVAL_MS - 1, read);
    expect(read).toHaveBeenCalledTimes(3);

    await runPullRequestSyncOnce(T0 + 2 * MINUTE + PR_SYNC_SLOW_INTERVAL_MS, read);
    expect(read).toHaveBeenCalledTimes(4);
    expect(listConversationPullRequests(name)[0]?.snapshot).toBeNull();
  });

  it('never reads a merged or dismissed link through the fallback', async () => {
    const name = conversation('feature/final');
    linkExplicitly(name, 903);
    linkExplicitly(name, 904);
    setPullRequestLinkSnapshot({ host: 'github.com', repository: 'eltmon/overdeck', number: 903 }, {
      ...snapshotFromGhRow(pr(903, 'x', { state: 'MERGED', mergedAt: '2026-09-20T00:00:00Z' }) as never, '2026-09-20T00:00:00Z'),
    });
    getOverdeckDatabase().prepare('UPDATE conversation_pull_requests SET dismissed_at = ? WHERE number = 904').run(T0);
    const read = vi.fn(async () => null);

    await runPullRequestSyncOnce(T0, read);

    expect(read).not.toHaveBeenCalled();
  });
});

describe('startPullRequestSyncService — schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('first sweeps at boot +30s, then every 60s', async () => {
    conversation('feature/timed');
    prRows = [pr(6, 'feature/timed')];

    startPullRequestSyncService();
    await vi.advanceTimersByTimeAsync(PR_SYNC_BOOT_DELAY_MS - 1);
    expect(listRepoPullRequestsMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(listRepoPullRequestsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PR_SYNC_INTERVAL_MS);
    expect(listRepoPullRequestsMock).toHaveBeenCalledTimes(2);

    stopPullRequestSyncService();
    await vi.advanceTimersByTimeAsync(PR_SYNC_INTERVAL_MS * 3);
    expect(listRepoPullRequestsMock).toHaveBeenCalledTimes(2);
  });
});
