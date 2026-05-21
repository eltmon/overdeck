/**
 * Tests for in_review state transitions in tracker implementations (PAN-368)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { GitHubTracker } from '../github.js';
import { LinearTracker } from '../linear.js';

// Real UUID to satisfy the UUID check in LinearTracker.transitionIssue
const LINEAR_ISSUE_UUID = '11111111-1111-1111-1111-111111111111';

// ---------------------------------------------------------------------------
// GitHubTracker — in_review label swap
// ---------------------------------------------------------------------------

describe('GitHubTracker.transitionIssue(in_review)', () => {
  let addLabelsMock: ReturnType<typeof vi.fn>;
  let removeLabelMock: ReturnType<typeof vi.fn>;
  let getLabelMock: ReturnType<typeof vi.fn>;
  let getIssueMock: ReturnType<typeof vi.fn>;
  let tracker: GitHubTracker;

  const makeIssue = (labels: string[]) => ({
    id: '1',
    ref: '#1',
    title: 'Test issue',
    description: '',
    state: 'in_progress' as const,
    labels,
    url: 'https://github.com/owner/repo/issues/1',
    tracker: 'github' as const,
    priority: undefined,
    dueDate: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  beforeEach(() => {
    addLabelsMock = vi.fn().mockResolvedValue({});
    removeLabelMock = vi.fn().mockResolvedValue({});
    getLabelMock = vi.fn().mockResolvedValue({}); // label exists
    getIssueMock = vi.fn().mockReturnValue(Effect.succeed(makeIssue(['in-progress'])));

    tracker = new GitHubTracker('fake-token', 'owner', 'repo');

    const octokitMock = {
      issues: {
        addLabels: addLabelsMock,
        removeLabel: removeLabelMock,
        getLabel: getLabelMock,
        createLabel: vi.fn().mockResolvedValue({}),
      },
    };
    (tracker as any).octokit = octokitMock;
    (tracker as any).getIssue = getIssueMock;
  });

  it('adds in-review label', async () => {
    await Effect.runPromise(tracker.transitionIssue('1', 'in_review'));
    expect(addLabelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['in-review'] }),
    );
  });

  it('removes in-progress label when it is present', async () => {
    await Effect.runPromise(tracker.transitionIssue('1', 'in_review'));
    expect(removeLabelMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'in-progress' }),
    );
  });

  it('does not throw when in-progress label is absent and removeLabel fails', async () => {
    getIssueMock.mockReturnValue(Effect.succeed(makeIssue([])));
    removeLabelMock.mockRejectedValue(new Error('Label not found'));
    // Should not throw — removeLabel errors are swallowed by orElseSucceed
    await expect(
      Effect.runPromise(tracker.transitionIssue('1', 'in_review')),
    ).resolves.not.toThrow();
  });

  it('adds in-review label for issue with no prior labels', async () => {
    getIssueMock.mockReturnValue(Effect.succeed(makeIssue([])));
    removeLabelMock.mockRejectedValue(new Error('Label not found'));
    await Effect.runPromise(tracker.transitionIssue('1', 'in_review'));
    expect(addLabelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['in-review'] }),
    );
  });
});

// ---------------------------------------------------------------------------
// LinearTracker — in_review name-based state lookup
// ---------------------------------------------------------------------------

describe('LinearTracker.transitionIssue(in_review)', () => {
  let updateIssueMock: ReturnType<typeof vi.fn>;
  let tracker: LinearTracker;

  const makeTeamStates = (
    states: Array<{ id: string; name: string; type: string; position: number }>,
  ) => ({
    nodes: states,
  });

  const makeLinearIssue = (states: ReturnType<typeof makeTeamStates>) => ({
    id: LINEAR_ISSUE_UUID,
    identifier: 'PAN-1',
    title: 'Test issue',
    description: '',
    team: Promise.resolve({
      states: () => Promise.resolve(states),
    }),
    state: Promise.resolve({ type: 'started' }),
    assignee: Promise.resolve(null),
    labels: () => Promise.resolve({ nodes: [] }),
    url: 'https://linear.app/test/issue/PAN-1',
    priority: 3,
    dueDate: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    updateIssueMock = vi.fn().mockResolvedValue({});
    tracker = new LinearTracker('fake-api-key');

    const clientMock = {
      issue: vi.fn(),
      searchIssues: vi.fn(),
      updateIssue: updateIssueMock,
    };
    (tracker as any).client = clientMock;
  });

  it('transitions to "In Review" state when it exists', async () => {
    const states = makeTeamStates([
      { id: 'state-in-progress', name: 'In Progress', type: 'started', position: 1 },
      { id: 'state-in-review', name: 'In Review', type: 'started', position: 2 },
    ]);
    (tracker as any).client.issue = vi.fn().mockResolvedValue(makeLinearIssue(states));

    await Effect.runPromise(
      tracker.transitionIssue(LINEAR_ISSUE_UUID, 'in_review'),
    );

    expect(updateIssueMock).toHaveBeenCalledWith(LINEAR_ISSUE_UUID, {
      stateId: 'state-in-review',
    });
  });

  it('falls back to lowest-position started state when no "In Review" state exists', async () => {
    const states = makeTeamStates([
      { id: 'state-started-2', name: 'Active', type: 'started', position: 2 },
      { id: 'state-started-1', name: 'In Progress', type: 'started', position: 1 },
    ]);
    (tracker as any).client.issue = vi.fn().mockResolvedValue(makeLinearIssue(states));

    await Effect.runPromise(
      tracker.transitionIssue(LINEAR_ISSUE_UUID, 'in_review'),
    );

    // Should pick the lowest-position started state
    expect(updateIssueMock).toHaveBeenCalledWith(LINEAR_ISSUE_UUID, {
      stateId: 'state-started-1',
    });
  });

  it('is case-insensitive when matching "In Review" state name', async () => {
    const states = makeTeamStates([
      { id: 'state-in-review', name: 'in review', type: 'started', position: 1 },
    ]);
    (tracker as any).client.issue = vi.fn().mockResolvedValue(makeLinearIssue(states));

    await Effect.runPromise(
      tracker.transitionIssue(LINEAR_ISSUE_UUID, 'in_review'),
    );

    expect(updateIssueMock).toHaveBeenCalledWith(LINEAR_ISSUE_UUID, {
      stateId: 'state-in-review',
    });
  });

  it('throws when no started states exist at all', async () => {
    const states = makeTeamStates([
      { id: 'state-open', name: 'Open', type: 'unstarted', position: 1 },
    ]);
    (tracker as any).client.issue = vi.fn().mockResolvedValue(makeLinearIssue(states));

    await expect(
      Effect.runPromise(tracker.transitionIssue(LINEAR_ISSUE_UUID, 'in_review')),
    ).rejects.toThrow(/No "In Review" or "started" state found/);
  });
});

// ---------------------------------------------------------------------------
// LinearTracker — reverseMapState correctness
// ---------------------------------------------------------------------------

describe('LinearTracker reverseMapState', () => {
  let tracker: LinearTracker;

  beforeEach(() => {
    tracker = new LinearTracker('fake-api-key');
  });

  it('maps in_review to started (so listIssues({ state: in_review }) returns correct results)', () => {
    const result = (tracker as any).reverseMapState('in_review');
    expect(result).toBe('started');
  });

  it('maps in_progress to started', () => {
    const result = (tracker as any).reverseMapState('in_progress');
    expect(result).toBe('started');
  });
});
