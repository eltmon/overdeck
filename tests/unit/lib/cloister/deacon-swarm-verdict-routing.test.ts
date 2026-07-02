import { Effect } from 'effect';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VBriefDocument, VBriefItem } from '../../../../src/lib/vbrief/types.js';

const { mockMessageAgent, mockGetReviewStatus, mockWriteFeedbackFile, mockListSlotOwnership } = vi.hoisted(() => ({
  mockMessageAgent: vi.fn(),
  mockGetReviewStatus: vi.fn(),
  mockWriteFeedbackFile: vi.fn(),
  mockListSlotOwnership: vi.fn(),
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
  });

  it('delivers a verdict for a slot-owned item to agent-<issue>-slot-N', async () => {
    const workspacePath = await writePlan(plan([
      slotItem('wi-a'),
      slotItem('wi-b'),
    ]));
    mockListSlotOwnership.mockReturnValue([
      { slotIndex: 2, agentId: 'agent-pan-2203-slot-2', itemId: 'wi-b' },
    ]);

    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-2203',
      verdict: 'blocked',
      notes: 'fix wi-b',
      workspacePath,
      slotItemId: 'wi-b',
    }));

    expect(result.agentMessageSent).toBe(true);
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
    mockListSlotOwnership.mockReturnValue([
      { slotIndex: 2, agentId: 'agent-pan-2203-slot-2', itemId: 'wi-b' },
    ]);
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

  it('uses persisted slot ownership instead of plan order when routing verdict feedback', async () => {
    const workspacePath = await writePlan(plan([
      slotItem('wi-a'),
      slotItem('wi-b'),
      slotItem('wi-c'),
    ]));
    mockListSlotOwnership.mockReturnValue([
      { slotIndex: 1, agentId: 'agent-pan-2203-slot-1', itemId: 'wi-c' },
      { slotIndex: 2, agentId: 'agent-pan-2203-slot-2', itemId: 'wi-b' },
    ]);

    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-2203',
      verdict: 'blocked',
      notes: 'fix wi-c',
      workspacePath,
      slotItemId: 'wi-c',
    }));

    expect(result.agentMessageSent).toBe(true);
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-2203-slot-1',
      expect.stringContaining('MUST READ: /tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md'),
    );
    expect(mockMessageAgent).not.toHaveBeenCalledWith(
      'agent-pan-2203-slot-3',
      expect.any(String),
    );
  });

  it('does not guess a slot from plan order when persisted ownership is missing', async () => {
    const workspacePath = await writePlan(plan([
      slotItem('wi-a'),
      slotItem('wi-b'),
      slotItem('wi-c'),
    ]));

    const { deliverReviewVerdictFeedback } = await import('../../../../src/lib/cloister/review-verdict-feedback.js');
    const result = await Effect.runPromise(deliverReviewVerdictFeedback({
      issueId: 'PAN-2203',
      verdict: 'blocked',
      notes: 'fix wi-c',
      workspacePath,
      slotItemId: 'wi-c',
    }));

    expect(result.agentMessageSent).toBe(true);
    expect(mockMessageAgent).toHaveBeenCalledWith(
      'agent-pan-2203',
      expect.stringContaining('MUST READ: /tmp/workspace/.pan/feedback/001-review-agent-changes-requested.md'),
    );
    expect(mockMessageAgent).not.toHaveBeenCalledWith(
      'agent-pan-2203-slot-3',
      expect.any(String),
    );
  });
});
