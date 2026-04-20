/**
 * Tests for issue-filer (PAN-709)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileFlywheelIssues } from '../issue-filer.js';
import type { IssueProposal } from '../synthesis.js';

// ============================================================================
// Mocks
// ============================================================================

const mockCreateIssue = vi.fn();

vi.mock('../../tracker/factory.js', () => ({
  createTracker: vi.fn(() => ({ createIssue: mockCreateIssue })),
}));

import { createTracker } from '../../tracker/factory.js';

// ============================================================================
// Fixtures
// ============================================================================

function makeProposal(overrides: Partial<IssueProposal> = {}): IssueProposal {
  return {
    signature: {
      targetSkill: 'planning-agent',
      audience: 'work-agent',
      gapDescription: 'Missing step for verifying beads before handoff',
    },
    proposedType: 'update_skill',
    aggregatedChange: 'Add bead verification step before done signal',
    retroCount: 3,
    medianFrictionScore: 7.5,
    triggeringRetros: ['/docs/flywheel/retros/pan-001-ts.md'],
    ...overrides,
  };
}

// ============================================================================
// Suite: fileFlywheelIssues
// ============================================================================

describe('fileFlywheelIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore createTracker factory after clearing call history
    vi.mocked(createTracker).mockReturnValue({ createIssue: mockCreateIssue } as ReturnType<typeof createTracker>);
    mockCreateIssue.mockResolvedValue({
      id: '42',
      url: 'https://github.com/eltmon/panopticon-cli/issues/42',
      title: '',
    });
  });

  it('returns empty result when no proposals', async () => {
    const result = await fileFlywheelIssues([]);
    expect(result.filed).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it('files one issue per proposal', async () => {
    const proposals = [makeProposal(), makeProposal({ signature: { targetSkill: 'review-agent', audience: 'review-agent', gapDescription: 'Missing lint check' } })];
    mockCreateIssue
      .mockResolvedValueOnce({ id: '10', url: 'https://github.com/eltmon/panopticon-cli/issues/10', title: '' })
      .mockResolvedValueOnce({ id: '11', url: 'https://github.com/eltmon/panopticon-cli/issues/11', title: '' });

    const result = await fileFlywheelIssues(proposals, { owner: 'test-owner', repo: 'test-repo' });

    expect(result.filed).toHaveLength(2);
    expect(result.deferred).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(mockCreateIssue).toHaveBeenCalledTimes(2);
  });

  it('filed issue contains proposalSignature matching targetSkill|audience|gapDescription', async () => {
    const proposal = makeProposal();
    const result = await fileFlywheelIssues([proposal], { owner: 'o', repo: 'r' });

    expect(result.filed[0].proposalSignature).toBe(
      'planning-agent|work-agent|Missing step for verifying beads before handoff',
    );
  });

  it('createIssue is called with flywheel-change label', async () => {
    await fileFlywheelIssues([makeProposal()], { owner: 'o', repo: 'r' });

    const callArgs = mockCreateIssue.mock.calls[0][0];
    expect(callArgs.labels).toContain('flywheel-change');
  });

  it('title uses VERB_MAP to humanize proposedType', async () => {
    const proposal = makeProposal({ proposedType: 'add_skill' });
    await fileFlywheelIssues([proposal], { owner: 'o', repo: 'r' });

    const callArgs = mockCreateIssue.mock.calls[0][0];
    expect(callArgs.title).toMatch(/^flywheel: add /);
  });

  it('defers proposals beyond the 10-issue cap', async () => {
    const proposals = Array.from({ length: 12 }, (_, i) =>
      makeProposal({ signature: { targetSkill: `skill-${i}`, audience: '', gapDescription: 'desc' } }),
    );

    const result = await fileFlywheelIssues(proposals, { owner: 'o', repo: 'r' });

    expect(result.filed).toHaveLength(10);
    expect(result.deferred).toHaveLength(2);
    expect(mockCreateIssue).toHaveBeenCalledTimes(10);
  });

  it('records errors and continues filing remaining proposals', async () => {
    const proposals = [
      makeProposal({ signature: { targetSkill: 'skill-a', audience: '', gapDescription: 'desc' } }),
      makeProposal({ signature: { targetSkill: 'skill-b', audience: '', gapDescription: 'desc' } }),
    ];

    mockCreateIssue
      .mockRejectedValueOnce(new Error('API rate limit'))
      .mockResolvedValueOnce({ id: '20', url: 'https://github.com/eltmon/panopticon-cli/issues/20', title: '' });

    const result = await fileFlywheelIssues(proposals, { owner: 'o', repo: 'r' });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('API rate limit');
    expect(result.filed).toHaveLength(1);
  });

  it('issueNumber is parsed from the issue URL (same when id === visible number)', async () => {
    mockCreateIssue.mockResolvedValue({ id: '99', url: 'https://github.com/eltmon/panopticon-cli/issues/99', title: '' });

    const result = await fileFlywheelIssues([makeProposal()], { owner: 'o', repo: 'r' });

    expect(result.filed[0].issueNumber).toBe(99);
    expect(result.filed[0].issueUrl).toContain('/99');
  });

  it('issueNumber uses visible issue number from URL, not the internal GitHub node id', async () => {
    // Real GitHub: id is a large internal node id; visible number is the URL path segment
    mockCreateIssue.mockResolvedValue({
      id: '9876543210',
      ref: '#42',
      url: 'https://github.com/eltmon/panopticon-cli/issues/42',
      title: '',
    });

    const result = await fileFlywheelIssues([makeProposal()], { owner: 'o', repo: 'r' });

    expect(result.filed[0].issueNumber).toBe(42);
    expect(result.filed[0].issueNumber).not.toBe(9876543210);
  });

  it('triggeringRetros contains the basenames of the triggering retro paths', async () => {
    const proposal = makeProposal({
      triggeringRetros: [
        '/home/user/docs/flywheel/retros/pan-600-1714000000.md',
        '/home/user/docs/flywheel/retros/pan-601-1714000001.md',
      ],
    });

    const result = await fileFlywheelIssues([proposal], { owner: 'o', repo: 'r' });

    expect(result.filed[0].triggeringRetros).toEqual([
      'pan-600-1714000000.md',
      'pan-601-1714000001.md',
    ]);
  });
});
