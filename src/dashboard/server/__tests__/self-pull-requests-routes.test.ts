/**
 * PAN-4943 WI-6: the four self pull-request routes — agent-token-only
 * (`not-an-agent-token` for every other credential), the watch create/list/
 * delete codes, C-3's conversation resolution for `/api/self/pull-requests`,
 * and D-10's best-effort link. Real watch store and conversations DB under a
 * fixed temp OVERDECK_HOME (set before any import, since `projects.ts`
 * freezes it at module load); faked GitHub reads.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PullRequestSnapshot } from '@overdeck/contracts';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DashboardCredential } from '../routes/dashboard-auth.js';
import type { SelfCallerDeps } from '../self-caller.js';

const TEST_HOME = join(tmpdir(), `pan-4943-self-pr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });
writeFileSync(
  join(TEST_HOME, 'projects.yaml'),
  ['projects:', '  overdeck:', '    name: Overdeck', `    path: ${join(TEST_HOME, 'repo')}`, '    github_repo: eltmon/overdeck', ''].join('\n'),
  'utf-8',
);

const { createConversation } = await import('../../../lib/overdeck/conversations.js');
const { closeOverdeckDatabase, getOverdeckDatabase } = await import('../../../lib/overdeck/infra.js');
const {
  addPullRequestWatch,
  listPullRequestWatches,
  _resetPullRequestWatchStoreForTests,
  _settlePullRequestWatchWritesForTests,
} = await import('../../../lib/overdeck/pull-request-watches.js');
const {
  handlePullRequestWatchCreate,
  handlePullRequestWatchDelete,
  handlePullRequestWatchList,
  handleSelfPullRequestLink,
} = await import('../routes/self-pull-requests.js');

// Fakes the self-caller's own resolution (self-caller.ts); the route's own
// conversationNameForCaller reads the real conversations DB created below.
const callerDeps: SelfCallerDeps = {
  getAgentState: (agentId) => (agentId.startsWith('agent-pan-') ? { workspace: `/w/${agentId}`, issueId: 'PAN-1' } : null),
  getConversationByName: (name) => (name === 'conv-a' ? { cwd: '/p/conv-a', tmuxSession: 'conv-conv-a', issueId: null } : null),
};

function agentCredential(agentId: string, agentKind: 'agent' | 'conversation' = 'agent'): DashboardCredential {
  return { kind: 'token', tokenId: `tok-${agentId}`, scopes: ['read:state', 'tell'], agentId, agentKind, role: agentKind === 'agent' ? 'work' : 'conversation' };
}

const PLAIN_TOKEN: DashboardCredential = { kind: 'token', tokenId: 'tok-plain', scopes: ['admin'] };
const INTERNAL: DashboardCredential = { kind: 'internal-token' };

function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    state: 'open',
    isDraft: false,
    title: 'title',
    headBranch: null,
    baseBranch: null,
    reviewState: 'none',
    checks: 'pending',
    mergeable: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    author: null,
    updatedAt: null,
    mergedAt: null,
    closedAt: null,
    syncedAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  };
}

const PR_URL = 'https://github.com/eltmon/overdeck/pull/42';
/** Any directory; the origin-remote read fails harmlessly and github_repo already supplies the repo. */
const WORK_CWD = join(TEST_HOME, 'work');
mkdirSync(WORK_CWD, { recursive: true });

beforeEach(() => {
  closeOverdeckDatabase();
  getOverdeckDatabase().exec('DELETE FROM conversation_pull_requests; DELETE FROM conversations;');
  rmSync(join(TEST_HOME, 'pr-watches.json'), { force: true });
  _resetPullRequestWatchStoreForTests();
});

afterEach(async () => {
  await _settlePullRequestWatchWritesForTests();
  _resetPullRequestWatchStoreForTests();
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('POST /api/self/pull-request-watches', () => {
  it('a plain token and the internal credential get 403 not-an-agent-token', async () => {
    for (const credential of [PLAIN_TOKEN, INTERNAL, null]) {
      const result = await handlePullRequestWatchCreate(credential, JSON.stringify({ url: PR_URL }), { caller: callerDeps });
      expect(result.status).toBe(403);
      expect((result.body as { code: string }).code).toBe('not-an-agent-token');
    }
  });

  it('a GitLab merge request URL gets 400 invalid-url', async () => {
    const result = await handlePullRequestWatchCreate(
      agentCredential('agent-pan-1'),
      JSON.stringify({ url: 'https://gitlab.com/eltmon/overdeck/-/merge_requests/1' }),
      { caller: callerDeps },
    );
    expect(result.status).toBe(400);
    expect((result.body as { code: string }).code).toBe('invalid-url');
  });

  it('a read failure gets 502 and stores nothing', async () => {
    const result = await handlePullRequestWatchCreate(agentCredential('agent-pan-1'), JSON.stringify({ url: PR_URL }), {
      caller: callerDeps,
      readSnapshot: async () => null,
    });
    expect(result.status).toBe(502);
    expect((result.body as { code: string }).code).toBe('pr-read-failed');
    expect(await listPullRequestWatches()).toEqual([]);
  });

  it('an already-merged PR gets 409 and stores nothing', async () => {
    const result = await handlePullRequestWatchCreate(agentCredential('agent-pan-1'), JSON.stringify({ url: PR_URL }), {
      caller: callerDeps,
      readSnapshot: async () => snapshot({ state: 'merged' }),
    });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ code: 'pr-finished', state: 'merged' });
    expect(await listPullRequestWatches()).toEqual([]);
  });

  it('a work-agent caller with no conversation row gets 201 with linked: false and one stored watch', async () => {
    const result = await handlePullRequestWatchCreate(agentCredential('agent-pan-1'), JSON.stringify({ url: PR_URL }), {
      caller: callerDeps,
      readSnapshot: async () => snapshot(),
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ created: true, linked: false, linkError: 'no-conversation' });
    expect(await listPullRequestWatches({ agentId: 'agent-pan-1', agentKind: 'agent' })).toHaveLength(1);
  });

  it('a specialist agent caller with its own conversation row gets linked: true', async () => {
    // Fact 3: a specialist run's own conversation row is keyed by its agent id.
    createConversation({ name: 'agent-pan-review-1', tmuxSession: 'conv-agent-pan-review-1', cwd: WORK_CWD, projectKey: 'overdeck', workspaceId: null });
    const result = await handlePullRequestWatchCreate(agentCredential('agent-pan-review-1'), JSON.stringify({ url: PR_URL }), {
      caller: callerDeps,
      readSnapshot: async () => snapshot(),
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ created: true, linked: true });
  });

  it('a conversation caller gets linked: true', async () => {
    createConversation({ name: 'conv-a', tmuxSession: 'conv-conv-a', cwd: WORK_CWD, projectKey: 'overdeck', workspaceId: null });
    const result = await handlePullRequestWatchCreate(agentCredential('conv-a', 'conversation'), JSON.stringify({ url: PR_URL }), {
      caller: callerDeps,
      readSnapshot: async () => snapshot(),
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ created: true, linked: true });
  });

  it('a second POST for the same PR answers 200 created: false with no further read', async () => {
    const readSnapshot = async () => snapshot();
    const deps = { caller: callerDeps, readSnapshot };
    const first = await handlePullRequestWatchCreate(agentCredential('agent-pan-1'), JSON.stringify({ url: PR_URL }), deps);
    const second = await handlePullRequestWatchCreate(agentCredential('agent-pan-1'), JSON.stringify({ url: PR_URL }), deps);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ created: false });
    expect((second.body as { watch: { id: string } }).watch.id).toBe((first.body as { watch: { id: string } }).watch.id);
  });

  it('a non-string url gets 400 invalid-url', async () => {
    const result = await handlePullRequestWatchCreate(agentCredential('agent-pan-1'), JSON.stringify({}), { caller: callerDeps });
    expect(result.status).toBe(400);
    expect((result.body as { code: string }).code).toBe('invalid-url');
  });

  it('a non-object body gets 400 bad-body', async () => {
    const result = await handlePullRequestWatchCreate(agentCredential('agent-pan-1'), 'not json', { caller: callerDeps });
    expect(result.status).toBe(400);
    expect((result.body as { code: string }).code).toBe('bad-body');
  });
});

describe('GET /api/self/pull-request-watches', () => {
  it('lists only the caller’s own watches', async () => {
    await addPullRequestWatch({ agentId: 'agent-pan-1', agentKind: 'agent', key: { host: 'github.com', repository: 'eltmon/overdeck', number: 1, url: PR_URL }, last: { state: 'open', checks: 'pending', reviewState: 'none', mergeable: null } });
    await addPullRequestWatch({ agentId: 'agent-pan-2', agentKind: 'agent', key: { host: 'github.com', repository: 'eltmon/overdeck', number: 2, url: PR_URL }, last: { state: 'open', checks: 'pending', reviewState: 'none', mergeable: null } });

    const result = await handlePullRequestWatchList(agentCredential('agent-pan-1'), { caller: callerDeps });
    expect(result.status).toBe(200);
    expect((result.body as { watches: Array<{ number: number }> }).watches).toHaveLength(1);
    expect((result.body as { watches: Array<{ number: number }> }).watches[0]!.number).toBe(1);
  });
});

describe('DELETE /api/self/pull-request-watches/:id', () => {
  it('deletes the caller’s own watch, and refuses another owner’s id with 404 keeping the row', async () => {
    const added = await addPullRequestWatch({ agentId: 'agent-pan-1', agentKind: 'agent', key: { host: 'github.com', repository: 'eltmon/overdeck', number: 1, url: PR_URL }, last: { state: 'open', checks: 'pending', reviewState: 'none', mergeable: null } });
    if (!added.ok) throw new Error('unreachable');

    const wrongOwner = await handlePullRequestWatchDelete(agentCredential('agent-pan-2'), added.watch.id, { caller: callerDeps });
    expect(wrongOwner.status).toBe(404);
    expect((wrongOwner.body as { code: string }).code).toBe('unknown-watch');
    expect(await listPullRequestWatches({ agentId: 'agent-pan-1', agentKind: 'agent' })).toHaveLength(1);

    const ok = await handlePullRequestWatchDelete(agentCredential('agent-pan-1'), added.watch.id, { caller: callerDeps });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ removed: true, id: added.watch.id });
  });
});

describe('POST /api/self/pull-requests', () => {
  it('answers 404 no-conversation for a work agent with no conversation row', async () => {
    const result = await handleSelfPullRequestLink(agentCredential('agent-pan-1'), JSON.stringify({ ref: PR_URL }), { caller: callerDeps });
    expect(result.status).toBe(404);
    expect((result.body as { code: string }).code).toBe('no-conversation');
  });

  it('a plain token gets 403 not-an-agent-token', async () => {
    const result = await handleSelfPullRequestLink(PLAIN_TOKEN, JSON.stringify({ ref: PR_URL }), { caller: callerDeps });
    expect(result.status).toBe(403);
    expect((result.body as { code: string }).code).toBe('not-an-agent-token');
  });

  it('links to the caller’s own conversation when a specialist row exists for it', async () => {
    createConversation({ name: 'agent-pan-review-1', tmuxSession: 'conv-agent-pan-review-1', cwd: WORK_CWD, projectKey: 'overdeck', workspaceId: null });
    const result = await handleSelfPullRequestLink(agentCredential('agent-pan-review-1'), JSON.stringify({ ref: PR_URL }), { caller: callerDeps });
    expect(result.status).toBe(201);
  });
});
