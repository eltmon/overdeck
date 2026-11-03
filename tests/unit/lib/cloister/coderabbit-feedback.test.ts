/**
 * PAN-4773: CodeRabbit findings reach the work agent through the feedback
 * door, once per review, and nothing happens when CodeRabbit posted none.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCodeRabbitRelaysForTests,
  buildCodeRabbitFeedbackBody,
  codeRabbitDedupKey,
  maybeRelayCodeRabbitReview,
  relayCodeRabbitReview,
  type CodeRabbitFeedbackDeps,
  type CodeRabbitReviewEvent,
} from '../../../../src/lib/cloister/coderabbit-feedback.js';
import {
  fetchCodeRabbitReviewThreads,
  parseCodeRabbitComment,
  type CodeRabbitThread,
} from '../../../../src/lib/cloister/coderabbit-ingestion.js';

const WS = '/projects/overdeck/workspaces/feature-pan-1';
const EVENT: CodeRabbitReviewEvent = {
  issueId: 'PAN-1', repo: 'eltmon/overdeck', prNumber: 42, reviewId: 900, headRef: 'feature/pan-1',
};
const THREADS: CodeRabbitThread[] = [
  { id: 11, path: 'src/a.ts', line: 7, severity: 'Major', title: 'Guard the null case', url: 'https://github.com/x/11' },
  { id: 12, path: 'src/b.ts', title: 'Typo in the log line' },
];

function makeDeps(overrides: Partial<CodeRabbitFeedbackDeps> = {}) {
  const deps = {
    workspacePathFor: vi.fn(() => WS),
    fetchThreads: vi.fn(async () => THREADS),
    writeFeedback: vi.fn(async () => ({ success: true, filePath: `${WS}/.pan/feedback/003-coderabbit-findings.md` })),
    alreadyDelivered: vi.fn(() => false),
    recordDelivered: vi.fn(),
    resolveTarget: vi.fn(async () => ({ agentId: 'agent-pan-1' })),
    deliver: vi.fn(async () => ({ delivered: true })),
    surfaceNeedsYou: vi.fn(async () => {}),
    log: vi.fn(),
    ...overrides,
  };
  return deps as typeof deps & CodeRabbitFeedbackDeps;
}

beforeEach(() => __resetCodeRabbitRelaysForTests());
afterEach(() => vi.clearAllMocks());

describe('relayCodeRabbitReview', () => {
  it('writes every thread to a feedback file and delivers it keyed by the review', async () => {
    const deps = makeDeps();

    const outcome = await relayCodeRabbitReview(EVENT, deps);

    expect(outcome).toEqual({
      kind: 'delivered', agentId: 'agent-pan-1', threads: 2, feedbackPath: `${WS}/.pan/feedback/003-coderabbit-findings.md`,
    });
    expect(deps.fetchThreads).toHaveBeenCalledWith('eltmon/overdeck', 42, 900);
    expect(deps.writeFeedback).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'PAN-1', workspacePath: WS, specialist: 'coderabbit', outcome: 'findings',
      markdownBody: expect.stringContaining('Thread 11 · src/a.ts:7 [Major]: Guard the null case'),
    }));
    const key = codeRabbitDedupKey('PAN-1', 900);
    expect(deps.deliver).toHaveBeenCalledWith('agent-pan-1', expect.stringContaining('MUST READ'), key);
    expect(deps.recordDelivered).toHaveBeenCalledWith(WS, {
      issueId: 'PAN-1', kind: 'coderabbit', dedupKey: key, agentId: 'agent-pan-1', source: 'coderabbit-feedback',
    });
    expect(deps.surfaceNeedsYou).not.toHaveBeenCalled();
  });

  it('routes nothing when the review has no inline findings', async () => {
    const deps = makeDeps({ fetchThreads: vi.fn(async () => []) });

    await expect(relayCodeRabbitReview(EVENT, deps)).resolves.toEqual({ kind: 'no-findings' });
    expect(deps.writeFeedback).not.toHaveBeenCalled();
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.surfaceNeedsYou).not.toHaveBeenCalled();
  });

  it('delivers one review once when the webhook arrives twice at the same time', async () => {
    const deps = makeDeps();

    const [first, second] = await Promise.all([relayCodeRabbitReview(EVENT, deps), relayCodeRabbitReview(EVENT, deps)]);

    expect(first.kind).toBe('delivered');
    expect(second).toEqual({ kind: 'already-delivered' });
    expect(deps.deliver).toHaveBeenCalledTimes(1);
  });

  it('does not re-deliver a review the journal already records', async () => {
    const deps = makeDeps({ alreadyDelivered: vi.fn(() => true) });

    await expect(relayCodeRabbitReview(EVENT, deps)).resolves.toEqual({ kind: 'already-delivered' });
    expect(deps.alreadyDelivered).toHaveBeenCalledWith(WS, codeRabbitDedupKey('PAN-1', 900));
    expect(deps.fetchThreads).not.toHaveBeenCalled();
  });

  it('skips a branch that is not a pipeline branch, and an issue with no workspace', async () => {
    const deps = makeDeps();
    await expect(relayCodeRabbitReview({ ...EVENT, headRef: 'strike/pan-1' }, deps)).resolves.toMatchObject({ kind: 'skipped' });

    const noWorkspace = makeDeps({ workspacePathFor: vi.fn(() => null) });
    await expect(relayCodeRabbitReview(EVENT, noWorkspace)).resolves.toMatchObject({ kind: 'skipped' });
    expect(deps.fetchThreads).not.toHaveBeenCalled();
    expect(noWorkspace.fetchThreads).not.toHaveBeenCalled();
  });

  it('raises Needs-you with the feedback file when no work agent can take the findings', async () => {
    const deps = makeDeps({ resolveTarget: vi.fn(async () => ({ reason: 'no work agent for PAN-1' })) });

    const outcome = await relayCodeRabbitReview(EVENT, deps);

    expect(outcome).toMatchObject({ kind: 'needs-you', threads: 2 });
    expect(deps.surfaceNeedsYou).toHaveBeenCalledWith(
      'PAN-1',
      expect.stringContaining('no work agent for PAN-1'),
      expect.objectContaining({ specialist: 'coderabbit', feedbackPath: `${WS}/.pan/feedback/003-coderabbit-findings.md` }),
    );
    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.recordDelivered).not.toHaveBeenCalled();
  });

  it('raises Needs-you, and records no delivery, when the message is not accepted or fails', async () => {
    const refused = makeDeps({ deliver: vi.fn(async () => ({ delivered: false, reason: 'pane is gone' })) });
    await expect(relayCodeRabbitReview(EVENT, refused)).resolves.toMatchObject({ kind: 'needs-you', reason: expect.stringContaining('pane is gone') });
    expect(refused.recordDelivered).not.toHaveBeenCalled();

    __resetCodeRabbitRelaysForTests();
    const thrown = makeDeps({ deliver: vi.fn(async () => { throw new Error('socket closed'); }) });
    await expect(relayCodeRabbitReview(EVENT, thrown)).resolves.toMatchObject({ kind: 'needs-you', reason: expect.stringContaining('socket closed') });
    expect(thrown.recordDelivered).not.toHaveBeenCalled();
  });

  it('never throws when reading the findings fails', async () => {
    const deps = makeDeps({ fetchThreads: vi.fn(async () => { throw new Error('gh: 502'); }) });

    await expect(relayCodeRabbitReview(EVENT, deps)).resolves.toEqual({ kind: 'skipped', reason: 'gh: 502' });
    expect(deps.deliver).not.toHaveBeenCalled();
  });
});

describe('buildCodeRabbitFeedbackBody', () => {
  it('tells the agent to fix or reply on the thread, and to push only after a change', () => {
    const body = buildCodeRabbitFeedbackBody(EVENT, THREADS);

    expect(body).toContain('- Thread 12 · src/b.ts: Typo in the log line');
    expect(body).toContain('gh api repos/eltmon/overdeck/pulls/42/comments/<thread id>/replies -f body="<reason>"');
    expect(body).toContain('pan review request PAN-1');
    expect(body).toContain('If you only replied, you are done.');
    expect(body).toContain('If PR #42 has already merged when you read this');
  });
});

describe('maybeRelayCodeRabbitReview', () => {
  const payload = (review: Record<string, unknown>, action = 'submitted') => ({
    action,
    repository: { full_name: 'eltmon/overdeck' },
    pull_request: { number: 42, head: { ref: 'feature/pan-1' } },
    review,
  });

  it('ignores reviews from anyone but CodeRabbit, unsubmitted ones, and dismissed ones', () => {
    expect(maybeRelayCodeRabbitReview(payload({ id: 1, state: 'commented', user: { login: 'overdeck-agent[bot]' } }), 'PAN-1')).toBeNull();
    expect(maybeRelayCodeRabbitReview(payload({ id: 1, state: 'commented', user: { login: 'coderabbitai[bot]' } }, 'edited'), 'PAN-1')).toBeNull();
    expect(maybeRelayCodeRabbitReview(payload({ id: 1, state: 'dismissed', user: { login: 'coderabbitai[bot]' } }), 'PAN-1')).toBeNull();
  });
});

describe('CodeRabbit thread parsing (real comments from #4667 and #4716)', () => {
  const FIXTURES = join(__dirname, '../../../fixtures/coderabbit');
  const fixtureRows = (pr: number) => readFileSync(join(FIXTURES, `pr-${pr}-comments.jsonl`), 'utf-8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line) as { pull_request_review_id: number; body: string });

  /** Plays `gh api --paginate pulls/<n>/comments --jq 'select(.pull_request_review_id == <id>)'` over a fixture. */
  const ghOver = (pr: number) => vi.fn(async (args: string[]) => {
    const reviewId = Number(/pull_request_review_id == (\d+)/.exec(args.join(' '))?.[1]);
    return fixtureRows(pr).filter((row) => row.pull_request_review_id === reviewId).map((row) => JSON.stringify(row)).join('\n');
  });

  it('reads severity and title from the current header format, not the icon markup', () => {
    const [first, second] = fixtureRows(4667);

    expect(parseCodeRabbitComment(first.body)).toEqual({
      severity: 'Minor', title: 'Register `messageRows.test.tsx` in `test:frontend-subset`.',
    });
    expect(parseCodeRabbitComment(second.body)).toEqual({
      severity: 'Minor', title: 'Gate `citationsEnabled` on the composer actually being mounted.',
    });
  });

  it('falls back to the first plain line of a body in no known shape', () => {
    expect(parseCodeRabbitComment('<!-- x -->\nConsider a shorter name here.\n\nMore text.')).toEqual({ title: 'Consider a shorter name here.' });
  });

  it('reads one review\'s threads from the PR comment list, with path and line', async () => {
    const gh = ghOver(4667);

    const threads = await fetchCodeRabbitReviewThreads('eltmon/overdeck', 4667, 5726882852, gh);

    expect(gh).toHaveBeenCalledWith(expect.arrayContaining(['--paginate', 'repos/eltmon/overdeck/pulls/4667/comments?per_page=100']));
    expect(threads).toEqual([
      {
        id: 4434689071, path: 'package.json', line: 141, severity: 'Minor',
        title: 'Register `messageRows.test.tsx` in `test:frontend-subset`.',
        url: 'https://github.com/eltmon/overdeck/pull/4667#discussion_r4434689071',
      },
      {
        id: 4434689073, path: 'src/dashboard/frontend/src/components/chat/ConversationPanel.tsx', line: 1471, severity: 'Minor',
        title: 'Gate `citationsEnabled` on the composer actually being mounted.',
        url: 'https://github.com/eltmon/overdeck/pull/4667#discussion_r4434689073',
      },
    ]);
  });

  it('leaves out CodeRabbit\'s replies, and a review with only replies routes nothing', async () => {
    const findings = await fetchCodeRabbitReviewThreads('eltmon/overdeck', 4716, 5728212281, ghOver(4716));
    expect(findings).toEqual([expect.objectContaining({
      id: 4435754182, line: 42, severity: 'Minor', title: 'Do not intercept links for issues absent from the dashboard snapshot.',
    })]);

    // CodeRabbit's later reply (in_reply_to_id set) is its own review.
    await expect(fetchCodeRabbitReviewThreads('eltmon/overdeck', 4716, 5728694109, ghOver(4716))).resolves.toEqual([]);
  });
});
