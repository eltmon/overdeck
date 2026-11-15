/**
 * PAN-5310 FR-8: `readIssueFromTracker` reads GitHub first for a
 * GitHub-resolved id, ahead of the configured tracker order — a
 * Linear-primary machine still reads a GitHub-prefixed id from GitHub.
 */

import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadConfigSync = vi.hoisted(() => vi.fn());
vi.mock('../../config.js', () => ({ loadConfigSync: mockLoadConfigSync }));

const mockCreateTracker = vi.hoisted(() => vi.fn());
const mockCreateTrackerFromConfig = vi.hoisted(() => vi.fn());
const mockCreateJiraTrackerForIssue = vi.hoisted(() => vi.fn());
vi.mock('../../tracker/factory.js', () => ({
  createTracker: mockCreateTracker,
  createTrackerFromConfig: mockCreateTrackerFromConfig,
  createJiraTrackerForIssue: mockCreateJiraTrackerForIssue,
}));

const mockResolveGitHubIssue = vi.hoisted(() => vi.fn());
const mockResolveTrackerType = vi.hoisted(() => vi.fn());
vi.mock('../../tracker-utils.js', () => ({
  resolveGitHubIssue: mockResolveGitHubIssue,
  resolveTrackerType: mockResolveTrackerType,
}));

import { getDerivedIssueState, readIssueFromTracker } from '../derived-issue-state.js';

describe('readIssueFromTracker tracker order (PAN-5310)', () => {
  beforeEach(() => {
    mockLoadConfigSync.mockReset();
    mockCreateTracker.mockReset();
    mockCreateTrackerFromConfig.mockReset();
    mockCreateJiraTrackerForIssue.mockReset();
    mockResolveGitHubIssue.mockReset();
    mockResolveTrackerType.mockReset();
    mockLoadConfigSync.mockReturnValue({ trackers: { primary: 'linear', linear: {} } });
    mockResolveTrackerType.mockReturnValue('github');
  });

  it('reads GitHub for a GitHub-resolved id when primary is linear', async () => {
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'lexerra', prefix: 'LEX', number: 609 });
    mockCreateTracker.mockReturnValue({ getIssue: () => Effect.succeed({ state: 'closed', labels: [], title: 'x' }) });

    const result = await readIssueFromTracker('LEX-609');

    expect(mockCreateTracker).toHaveBeenCalledWith(expect.objectContaining({ type: 'github', owner: 'eltmon', repo: 'lexerra' }));
    expect(result).toEqual({ open: false, labels: [], title: 'x' });
  });

  it('falls back to the configured tracker when GitHub fails', async () => {
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: true, owner: 'eltmon', repo: 'lexerra', prefix: 'LEX', number: 609 });
    mockCreateTracker.mockReturnValue({ getIssue: () => Effect.fail(new Error('unknown')) });
    mockCreateTrackerFromConfig.mockReturnValue({ getIssue: () => Effect.succeed({ state: 'open', labels: [] }) });

    const result = await readIssueFromTracker('LEX-609');

    expect(result?.open).toBe(true);
  });

  it('never tries GitHub for an id that does not resolve', async () => {
    mockResolveGitHubIssue.mockReturnValue({ isGitHub: false });
    mockCreateTrackerFromConfig.mockReturnValue({ getIssue: () => Effect.succeed({ state: 'open', labels: [] }) });

    await readIssueFromTracker('PAN-1');

    expect(mockCreateTracker).not.toHaveBeenCalled();
  });

  it('a closed tracker answer yields closed state and no pr-outside-pipeline', async () => {
    const derived = await getDerivedIssueState('LEX-609', {
      readIssue: async () => ({ open: false, labels: [] }),
      readPr: async () => ({
        url: 'https://example.test/pr/1', number: 1, reviewState: 'review-requested' as const,
        checks: 'pending' as const, mergeable: null, merged: false,
      }),
      readBranch: async () => null,
      panes: [],
      readPrOutsidePipeline: async () => undefined as any,
      isDeftPipeline: async () => false,
    });

    expect(derived.state).toBe('closed');
    expect(derived.attention).toBeUndefined();
    expect(derived.prOutsidePipeline).toBeUndefined();
  });
});
