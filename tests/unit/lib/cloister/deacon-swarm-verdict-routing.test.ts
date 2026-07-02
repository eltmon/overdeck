import { Effect } from 'effect';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

const {
  mockMessageAgent,
  mockGetReviewStatus,
  mockWriteFeedbackFile,
  mockListSlotOwnership,
  mockResolveIssueFeedbackTarget,
  mockSurfaceIssueFeedbackNeedsYou,
} = vi.hoisted(() => ({
  mockMessageAgent: vi.fn(),
  mockGetReviewStatus: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
  mockListSlotOwnership: vi.fn(),
  mockResolveIssueFeedbackTarget: vi.fn(),
  mockSurfaceIssueFeedbackNeedsYou: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd, _args, _options, callback) => callback(null, '', '')),
}));

vi.mock('../../../../src/lib/agents.js', () => ({
  messageAgent: mockMessageAgent,
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatus,
}));

vi.mock('../../../../src/lib/cloister/feedback-writer.js', () => ({
  writeFeedbackFile: mockWriteFeedbackFile,
}));

vi.mock('../../../../src/lib/agents/slot-reconcile.js', () => ({
  listSlotOwnership: mockListSlotOwnership,
}));

vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: mockResolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou: mockSurfaceIssueFeedbackNeedsYou,
}));

function plan(items: VBriefItem[]): VBriefDocument {
  return {
    vBRIEFInfo: {
      version: '0.6',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      author: 'test',
      description: 'test plan',
    },
    plan: {
      id: 'pan-2203',
      title: 'test plan',
      status: 'active',
      created: '2026-07-01T00:00:00.000Z',
      updated: '2026-07-01T00:00:00.000Z',
      items,
      edges: [],
    },
  };
}

function slotItem(id: string): VBriefItem {
  return {
    id,
    title: id,
    status: 'running',
    metadata: {
      readiness: 'ready',
      files_scope: [`src/${id}.ts`],
      files_scope_confidence: 'high',
      verify_commands: ['npm run typecheck'],
      expected_outputs: ['typecheck completes without errors'],
    },
  };
}

async function writePlan(doc: VBriefDocument): Promise<string> {
  const workspace = join(tmpdir(), `pan-verdict-routing-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(join(workspace, '.pan'), { recursive: true });
  await writeFile(join(workspace, '.pan', 'spec.vbrief.json'), JSON.stringify(doc, null, 2));
  return workspace;
}

describe('swarm verdict feedback routing', () => {
  beforeEach(() => {
    mockMessageAgent.mockReset();
    mockGetReviewStatus.mockReset();
    mockWriteFeedbackFile.mockReset();
    mockListSlotOwnership.mockReset();
    mockGetReviewStatus.mockReturnValue({});
    mockWriteFeedbackFile.mockReturnValue(Effect.succeed({
      success: true,
      filePath: '/tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      relativePath: '.pan/feedback/001-review-agent-changes-requested.md',
    }));
    mockListSlotOwnership.mockReturnValue([]);
    mockResolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-2203' });
    mockSurfaceIssueFeedbackNeedsYou.mockReset();
  });

  it('delivers a verdict to the swarm-aware resolved target', async () => {
    const workspacePath = await writePlan(plan([
      slotItem('wi-a'),
      slotItem('wi-b'),
    ]));
    mockResolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-2203-slot-2' });

    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-2203',
      verdict: 'blocked',
      notes: 'fix wi-b',
      workspacePath,
      slotItemId: 'wi-b',
    }));

    expect(result.agentMessageSent).toBe(true);
    expect(mockResolveIssueFeedbackTarget).toHaveBeenCalledWith('PAN-2203', { itemId: 'wi-b' });
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-2203-slot-2',
      expect.stringContaining('MUST READ: /tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md'),
    );
  });

  it('does not target the missing parent agent when the owning slot is resolvable', async () => {
    const workspacePath = await writePlan(plan([
      slotItem('wi-a'),
      slotItem('wi-b'),
    ]));
    mockResolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-2203-slot-2' });
    mockMessageAgent.mockImplementation(async (agentId: string) => {
      if (agentId === 'agent-pan-2203') throw new Error('parent agent missing');
    });

    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-2203',
      verdict: 'failed',
      notes: 'fix wi-b',
      workspacePath,
      slotItemId: 'wi-b',
    }));

    expect(result.agentMessageSent).toBe(true);
    expect(mockMessageAgent).toHaveBeenCalledTimes(1);
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-2203-slot-2',
      expect.any(String),
    );
    expect(mockMessageAgent).not.toHaveBeenCalledWith(
      'agent-pan-2203',
      expect.any(String),
    );
  });

  it('passes the slot item id into the shared resolver instead of guessing plan order', async () => {
    const workspacePath = await writePlan(plan([
      slotItem('wi-a'),
      slotItem('wi-b'),
      slotItem('wi-c'),
    ]));
    mockResolveIssueFeedbackTarget.mockResolvedValue({ agentId: 'agent-pan-2203-slot-1' });

    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-2203',
      verdict: 'blocked',
      notes: 'fix wi-c',
      workspacePath,
      slotItemId: 'wi-c',
    }));

    expect(result.agentMessageSent).toBe(true);
    expect(mockResolveIssueFeedbackTarget).toHaveBeenCalledWith('PAN-2203', { itemId: 'wi-c' });
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-2203-slot-1',
      expect.stringContaining('MUST READ: /tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md'),
    );
    expect(mockMessageAgent).not.toHaveBeenCalledWith(
      'agent-pan-2203-slot-3',
      expect.any(String),
    );
  });

  it('surfaces needs-you instead of falling back silently when no target is resolved', async () => {
    const workspacePath = await writePlan(plan([
      slotItem('wi-a'),
      slotItem('wi-b'),
      slotItem('wi-c'),
    ]));
    mockResolveIssueFeedbackTarget.mockResolvedValue({
      needsYou: true,
      reason: 'No live feedback target for PAN-2203 for item wi-c',
    });

    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-2203',
      verdict: 'blocked',
      notes: 'fix wi-c',
      workspacePath,
      slotItemId: 'wi-c',
    }));

    expect(result.agentMessageSent).toBe(false);
    expect(mockMessageAgent).not.toHaveBeenCalled();
    expect(mockSurfaceIssueFeedbackNeedsYou).toHaveBeenCalledWith('PAN-2203', 'No live feedback target for PAN-2203 for item wi-c', {
      specialist: 'review-agent',
      feedbackPath: '/tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md',
      slotItemId: 'wi-c',
    });
  });
});
