import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// PAN-3822: explicit link/unlink commands shared by the dashboard routes and
// `pan conv link-pr` / `unlink-pr` / `prs`. Real temp overdeck.db; the git
// origin read is injected.

const TEST_HOME = join(tmpdir(), `pr-link-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
process.env.HOME = TEST_HOME;

const REPO_PATH = join(TEST_HOME, 'projects', 'overdeck');
const OTHER_CWD = join(TEST_HOME, 'scratch');

const emitOnlyMock = vi.fn();
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: emitOnlyMock })),
}));

const { createConversation } = await import('../conversations.js');
const { closeOverdeckDatabase, getOverdeckDatabase } = await import('../infra.js');
const {
  linkCreatedPullRequestToIssueConversations,
  listConversationPullRequests,
  unlinkConversationPullRequest,
  upsertBranchPullRequestLink,
} = await import('../conversation-pull-requests.js');
const {
  getConversationPullRequests,
  linkPullRequestToConversation,
  resolveConversationPullRequestRepos,
  unlinkPullRequestFromConversation,
} = await import('../conversation-pull-request-commands.js');

const deps = { readOriginRemote: async (dir: string) => (dir === REPO_PATH ? 'git@github.com:eltmon/overdeck.git' : null) };
const PR_URL = 'https://github.com/eltmon/overdeck/pull/42';

function conversation(name: string, cwd: string = join(REPO_PATH, 'workspaces', name), issueId?: string): string {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd, title: name, issueId });
  return name;
}

function conversationId(name: string): string {
  return getOverdeckDatabase().prepare('SELECT id FROM conversations WHERE name = ?').get<{ id: string }>(name)!.id;
}

function emittedEffectiveNumbers(): Array<number | null> {
  return emitOnlyMock.mock.calls.map(([event]) => (event as { payload: { effective: { number: number } | null } }).payload.effective?.number ?? null);
}

beforeAll(() => {
  mkdirSync(REPO_PATH, { recursive: true });
  mkdirSync(OTHER_CWD, { recursive: true });
  writeFileSync(
    join(TEST_HOME, 'projects.yaml'),
    ['projects:', '  overdeck:', '    name: Overdeck', `    path: ${REPO_PATH}`, '    github_repo: Eltmon/Overdeck', ''].join('\n'),
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
  emitOnlyMock.mockClear();
});

describe('resolveConversationPullRequestRepos', () => {
  it('lists the project repo first and dedupes the matching origin remote', async () => {
    const { repos } = await resolveConversationPullRequestRepos({ cwd: join(REPO_PATH, 'x'), projectKey: null }, deps);
    expect(repos).toEqual([{ host: 'github.com', repository: 'eltmon/overdeck', forge: 'github' }]);
  });

  it('falls back to the cwd origin for a conversation outside every project', async () => {
    const { repos } = await resolveConversationPullRequestRepos(
      { cwd: OTHER_CWD, projectKey: null },
      { readOriginRemote: async () => 'https://github.com/someone/scratch.git' },
    );
    expect(repos).toEqual([{ host: 'github.com', repository: 'someone/scratch', forge: 'github' }]);
  });
});

describe('linkPullRequestToConversation', () => {
  it('links a PR URL as manual, returns 201, and emits the effective link', async () => {
    const name = conversation('link-url');
    const result = await linkPullRequestToConversation(name, `${PR_URL}/files`, 'manual', deps);
    expect(result).toMatchObject({ ok: true, status: 201, body: { number: 42, source: 'manual', url: PR_URL } });
    expect(listConversationPullRequests(name)).toHaveLength(1);
    expect(emittedEffectiveNumbers()).toEqual([42]);
  });

  it('resolves #42 and owner/repo#42 against the project repository', async () => {
    const name = conversation('link-short');
    expect(await linkPullRequestToConversation(name, '#42', 'agent', deps)).toMatchObject({ ok: true, body: { url: PR_URL, source: 'agent' } });
    expect(await linkPullRequestToConversation(name, 'eltmon/overdeck#43', 'agent', deps)).toMatchObject({ ok: true, body: { number: 43 } });
  });

  it('refuses a foreign repository and never stores it', async () => {
    const name = conversation('link-foreign');
    const result = await linkPullRequestToConversation(name, 'https://github.com/someone/else/pull/1', 'manual', deps);
    expect(result).toMatchObject({ ok: false, status: 400, body: { code: 'foreign_repository' } });
    expect(listConversationPullRequests(name)).toEqual([]);
    expect(emitOnlyMock).not.toHaveBeenCalled();
  });

  it('refuses garbage and an issue URL as invalid_ref', async () => {
    const name = conversation('link-garbage');
    expect(await linkPullRequestToConversation(name, 'hello', 'manual', deps)).toMatchObject({ status: 400, body: { code: 'invalid_ref' } });
    expect(await linkPullRequestToConversation(name, 'https://github.com/eltmon/overdeck/issues/42', 'manual', deps))
      .toMatchObject({ status: 400, body: { code: 'invalid_ref' } });
  });

  it('returns 404 for an unknown conversation', async () => {
    expect(await linkPullRequestToConversation('nope', PR_URL, 'manual', deps)).toMatchObject({ status: 404, body: { code: 'not_found' } });
  });

  it('upgrades a branch link in place, keeping its snapshot, and relinking keeps one row', async () => {
    const name = conversation('link-upgrade');
    upsertBranchPullRequestLink(conversationId(name), { host: 'github.com', repository: 'eltmon/overdeck', number: 42, url: PR_URL }, {
      state: 'open', isDraft: false, title: 'Branch PR', headBranch: 'feature/x', baseBranch: 'main',
      reviewState: 'none', checks: 'passing', mergeable: true, additions: null, deletions: null, changedFiles: null,
      author: null, updatedAt: null, mergedAt: null, closedAt: null, syncedAt: '2026-09-24T00:00:00Z',
    } as never);
    await linkPullRequestToConversation(name, PR_URL, 'manual', deps);
    await linkPullRequestToConversation(name, '#42', 'agent', deps);
    const links = listConversationPullRequests(name);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ source: 'agent', snapshot: { title: 'Branch PR' } });
  });

  it('starts the snapshot refresh and emits again when it lands', async () => {
    const name = conversation('link-refresh');
    let release: () => void = () => {};
    const refreshLink = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    await linkPullRequestToConversation(name, PR_URL, 'manual', { ...deps, refreshLink });
    expect(refreshLink).toHaveBeenCalledWith(expect.objectContaining({ number: 42 }));
    expect(emitOnlyMock).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(emitOnlyMock).toHaveBeenCalledTimes(2));
  });
});

describe('unlinkPullRequestFromConversation', () => {
  it('dismisses the link, so the sweep cannot re-add it, and an explicit relink clears the dismissal', async () => {
    const name = conversation('unlink');
    await linkPullRequestToConversation(name, PR_URL, 'manual', deps);
    emitOnlyMock.mockClear();

    const result = await unlinkPullRequestFromConversation(name, '#42', deps);
    expect(result).toMatchObject({ ok: true, status: 200, body: { unlinked: true, link: { number: 42 } } });
    expect(emittedEffectiveNumbers()).toEqual([null]);
    const view = getConversationPullRequests(name);
    expect(view).toMatchObject({ ok: true, body: { effective: null } });
    expect(listConversationPullRequests(name)[0]?.dismissedAt).not.toBeNull();
    expect(upsertBranchPullRequestLink(conversationId(name), { host: 'github.com', repository: 'eltmon/overdeck', number: 42, url: PR_URL }, {} as never)).toBe(false);

    await linkPullRequestToConversation(name, PR_URL, 'created', deps);
    expect(listConversationPullRequests(name)[0]?.dismissedAt).not.toBeNull();

    await linkPullRequestToConversation(name, PR_URL, 'manual', deps);
    expect(listConversationPullRequests(name)[0]).toMatchObject({ dismissedAt: null, source: 'manual' });
  });

  it('returns not_linked for a PR that is not linked (or already unlinked)', async () => {
    const name = conversation('unlink-missing');
    expect(await unlinkPullRequestFromConversation(name, PR_URL, deps)).toMatchObject({ status: 404, body: { code: 'not_linked' } });
    await linkPullRequestToConversation(name, PR_URL, 'manual', deps);
    await unlinkPullRequestFromConversation(name, PR_URL, deps);
    expect(await unlinkPullRequestFromConversation(name, PR_URL, deps)).toMatchObject({ status: 404, body: { code: 'not_linked' } });
  });

  it('returns 404 for an unknown conversation', async () => {
    expect(await unlinkPullRequestFromConversation('nope', PR_URL, deps)).toMatchObject({ status: 404, body: { code: 'not_found' } });
  });
});

describe('linkCreatedPullRequestToIssueConversations (pipeline-opened PRs)', () => {
  it('links the PR as created to every agent conversation for the issue, never an operator one', () => {
    const work = conversation('agent-pan-3822', join(REPO_PATH, 'workspaces', 'feature-pan-3822'), 'PAN-3822');
    const review = conversation('specialist-review-pan-3822', REPO_PATH, 'pan-3822');
    const operator = conversation('operator-chat', REPO_PATH, 'PAN-3822');
    conversation('agent-pan-9999', REPO_PATH, 'PAN-9999');

    expect(linkCreatedPullRequestToIssueConversations('PAN-3822', PR_URL).sort()).toEqual([review, work].sort());
    expect(listConversationPullRequests(work)).toEqual([expect.objectContaining({ number: 42, source: 'created', url: PR_URL })]);
    expect(listConversationPullRequests(review)).toHaveLength(1);
    expect(listConversationPullRequests(operator)).toEqual([]);
    expect(listConversationPullRequests('agent-pan-9999')).toEqual([]);
    expect(emitOnlyMock).toHaveBeenCalledTimes(2);
  });

  it('is idempotent and leaves an operator dismissal alone', () => {
    const work = conversation('agent-pan-1', REPO_PATH, 'PAN-1');
    linkCreatedPullRequestToIssueConversations('PAN-1', PR_URL);
    emitOnlyMock.mockClear();
    expect(linkCreatedPullRequestToIssueConversations('PAN-1', PR_URL)).toEqual([]);
    expect(emitOnlyMock).not.toHaveBeenCalled();

    unlinkConversationPullRequest(work, { host: 'github.com', repository: 'eltmon/overdeck', number: 42 });
    expect(linkCreatedPullRequestToIssueConversations('PAN-1', PR_URL)).toEqual([]);
    expect(listConversationPullRequests(work)[0]?.dismissedAt).not.toBeNull();
  });

  it('upgrades an existing branch link to created', () => {
    const work = conversation('agent-pan-2', REPO_PATH, 'PAN-2');
    upsertBranchPullRequestLink(conversationId(work), { host: 'github.com', repository: 'eltmon/overdeck', number: 42, url: PR_URL }, {} as never);
    expect(linkCreatedPullRequestToIssueConversations('PAN-2', PR_URL)).toEqual([work]);
    expect(listConversationPullRequests(work)[0]?.source).toBe('created');
  });

  it('ignores a missing or unparseable URL', () => {
    conversation('agent-pan-3', REPO_PATH, 'PAN-3');
    expect(linkCreatedPullRequestToIssueConversations('PAN-3', undefined)).toEqual([]);
    expect(linkCreatedPullRequestToIssueConversations('PAN-3', 'not a url')).toEqual([]);
  });
});
