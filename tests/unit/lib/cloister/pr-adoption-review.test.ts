import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));

import {
  __resetPrAdoptionForTests,
  adoptPrAndStartReview,
  answerMissingWorkspace,
  findOpenPipelinePr,
  type AdoptAndReviewOutcome,
} from '../../../../src/lib/cloister/pr-adoption-review.js';
import type { AdoptablePr, AdoptionOutcome } from '../../../../src/lib/cloister/pr-workspace-adoption.js';

const PR: AdoptablePr = { issueId: 'PAN-1', number: 7, headRef: 'feature/pan-1', headSha: 'a'.repeat(40), repo: 'acme/demo' };
const WS = '/repo/workspaces/feature-pan-1';

function harness(adoption: AdoptionOutcome | (() => Promise<AdoptionOutcome>)) {
  return {
    adopt: vi.fn(typeof adoption === 'function' ? adoption : async () => adoption),
    startReview: vi.fn(async () => ({ started: true as const })),
    announce: vi.fn(async () => undefined),
    journal: vi.fn((_ws: string, entry: Record<string, unknown>) => ({ at: 'now', ...entry }) as never),
  };
}

afterEach(() => {
  __resetPrAdoptionForTests();
});

describe('adoptPrAndStartReview (PAN-4605)', () => {
  it('announces a refusal once with the fix and never starts a review', async () => {
    const refusal: AdoptionOutcome = {
      adopted: false, reason: 'checked-out-elsewhere', detail: 'held', fix: 'remove /home/me/hoff then pan review request PAN-1', worktreePath: '/home/me/hoff',
    };
    const deps = harness(refusal);

    const outcome = await adoptPrAndStartReview(PR, { source: 'webhook', ...deps });

    expect(outcome).toEqual({ kind: 'refused', adoption: refusal });
    expect(deps.announce).toHaveBeenCalledTimes(1);
    expect(deps.announce).toHaveBeenCalledWith('PAN-1', `PR #7 was not reviewed: ${refusal.fix}`, {
      prNumber: 7, reason: 'checked-out-elsewhere', worktreePath: '/home/me/hoff',
    });
    expect(deps.startReview).not.toHaveBeenCalled();
  });

  it('starts the review once with the source and a note naming the PR', async () => {
    const deps = harness({ adopted: true, workspacePath: WS });

    const outcome = await adoptPrAndStartReview(PR, { source: 'webhook', ...deps });

    expect(outcome).toEqual({ kind: 'started', workspacePath: WS });
    expect(deps.startReview).toHaveBeenCalledTimes(1);
    expect(deps.startReview).toHaveBeenCalledWith('PAN-1', expect.objectContaining({ source: 'webhook', note: expect.stringContaining('PR #7') }));
    expect(deps.journal).not.toHaveBeenCalled();
    expect(deps.announce).not.toHaveBeenCalled();
  });

  it('journals review-not-started with the starter error text and announces it', async () => {
    const deps = harness({ adopted: true, workspacePath: WS });
    deps.startReview.mockResolvedValue({ started: false, reason: 'dirty-workspace', error: 'bun.lock modified' } as never);

    const outcome = await adoptPrAndStartReview(PR, { source: 'webhook', ...deps });

    expect(outcome).toEqual({ kind: 'review-not-started', workspacePath: WS, reason: 'dirty-workspace: bun.lock modified' });
    expect(deps.journal).toHaveBeenCalledWith(WS, expect.objectContaining({
      type: 'workspace.adoption-failed',
      issueId: 'PAN-1',
      source: 'pr-adoption',
      data: expect.objectContaining({ prNumber: 7, reason: 'review-not-started', detail: 'dirty-workspace: bun.lock modified' }),
    }));
    expect(deps.announce).toHaveBeenCalledTimes(1);
    expect(deps.announce.mock.calls[0]?.[1]).toContain('bun.lock modified');
  });

  it('journals no-starter when no review starter is registered', async () => {
    const deps = harness({ adopted: true, workspacePath: WS });

    const outcome = await adoptPrAndStartReview(PR, { source: 'webhook', ...deps, startReview: null });

    expect(outcome).toEqual({ kind: 'no-starter', workspacePath: WS });
    expect(deps.journal).toHaveBeenCalledWith(WS, expect.objectContaining({
      type: 'workspace.adoption-failed',
      data: expect.objectContaining({ reason: 'no-starter', fix: 'Run pan review request PAN-1.' }),
    }));
  });

  it('coalesces concurrent calls for the same issue into one adoption', async () => {
    let release!: (outcome: AdoptionOutcome) => void;
    const deps = harness(() => new Promise<AdoptionOutcome>((resolve) => { release = resolve; }));

    const first = adoptPrAndStartReview(PR, { source: 'webhook', ...deps });
    const second = adoptPrAndStartReview({ ...PR, issueId: 'pan-1' }, { source: 'pan-review-request', ...deps });
    release({ adopted: true, workspacePath: WS });
    const [a, b] = await Promise.all([first, second]);

    expect(deps.adopt).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toEqual<AdoptAndReviewOutcome>({ kind: 'started', workspacePath: WS });
  });

  it('catches and announces an adopt that throws', async () => {
    const deps = harness(async () => { throw new Error('git exploded'); });

    const outcome = await adoptPrAndStartReview(PR, { source: 'webhook', ...deps });

    expect(outcome).toMatchObject({ kind: 'refused', adoption: { adopted: false, reason: 'create-failed', detail: 'git exploded' } });
    expect(deps.announce).toHaveBeenCalledWith('PAN-1', 'PR #7 adoption failed: git exploded', expect.any(Object));
  });
});

describe('findOpenPipelinePr', () => {
  const projectPath = '/nonexistent/project-for-pan-4605';

  it('skips drafts and other branches and maps headRefOid', async () => {
    const gh = vi.fn(async () => JSON.stringify([
      { number: 5, url: 'https://github.com/acme/demo/pull/5', headRefName: 'feature/pan-1', headRefOid: 'd'.repeat(40), isDraft: true },
      { number: 6, url: 'https://github.com/acme/demo/pull/6', headRefName: 'Feature/PAN-1', headRefOid: 'e'.repeat(40), isDraft: false },
      { number: 7, url: 'https://github.com/acme/demo/pull/7', headRefName: 'feature/pan-1', headRefOid: 'f'.repeat(40), isDraft: false },
    ]));

    const lookup = await findOpenPipelinePr('PAN-1', { projectPath, gh });

    expect(lookup).toEqual({
      kind: 'found',
      pr: { issueId: 'PAN-1', number: 7, headRef: 'feature/pan-1', headSha: 'f'.repeat(40), repo: 'acme/demo' },
    });
    expect(gh).toHaveBeenCalledWith(
      ['pr', 'list', '--head', 'feature/pan-1', '--state', 'open', '--limit', '10', '--json', 'number,url,headRefName,headRefOid,isDraft'],
      projectPath,
    );
  });

  it('returns none for an empty listing', async () => {
    await expect(findOpenPipelinePr('PAN-1', { projectPath, gh: async () => '[]' })).resolves.toEqual({ kind: 'none' });
  });

  it('returns error when gh rejects', async () => {
    await expect(findOpenPipelinePr('PAN-1', { projectPath, gh: async () => { throw new Error('HTTP 502'); } }))
      .resolves.toEqual({ kind: 'error', message: 'HTTP 502' });
  });
});

describe('answerMissingWorkspace', () => {
  const found = { kind: 'found' as const, pr: PR };

  it('returns null when the workspace exists or the issue is merged', async () => {
    const findPr = vi.fn(async () => found);
    await expect(answerMissingWorkspace('PAN-1', 'pan-review-request', { derivedState: 'ready', workspaceExists: true }, { findPr })).resolves.toBeNull();
    await expect(answerMissingWorkspace('PAN-1', 'pan-review-request', { derivedState: 'merged', workspaceExists: false }, { findPr })).resolves.toBeNull();
    expect(findPr).not.toHaveBeenCalled();
  });

  it('answers 202 and starts adoption once for an approved PR with no workspace', async () => {
    const adoptAndReview = vi.fn(async () => ({ kind: 'started' as const, workspacePath: WS }));

    const answer = await answerMissingWorkspace('pan-1', 'pan-review-request', { derivedState: 'ready', workspaceExists: false }, {
      findPr: async () => found, adoptAndReview,
    });

    expect(answer?.status).toBe(202);
    expect(answer?.body).toMatchObject({ success: true, queued: true, adopting: true });
    expect(String(answer?.body['message'])).toContain('PR #7');
    expect(adoptAndReview).toHaveBeenCalledTimes(1);
    expect(adoptAndReview).toHaveBeenCalledWith(PR, { source: 'pan-review-request' });
  });

  it('answers 400 with a hint when there is no open pipeline PR', async () => {
    const answer = await answerMissingWorkspace('PAN-1', 'pan-review-request', { derivedState: 'working', workspaceExists: false }, {
      findPr: async () => ({ kind: 'none' }),
    });

    expect(answer).toEqual({
      status: 400,
      body: expect.objectContaining({ success: false, error: 'Workspace does not exist', hint: expect.stringContaining('pan workspace create PAN-1') }),
    });
  });

  it('answers 503 when GitHub cannot be read', async () => {
    const answer = await answerMissingWorkspace('PAN-1', 'pan-review-request', { derivedState: 'in-review', workspaceExists: false }, {
      findPr: async () => ({ kind: 'error', message: 'rate limited' }),
    });

    expect(answer?.status).toBe(503);
    expect(String(answer?.body['error'])).toContain('rate limited');
  });
});
