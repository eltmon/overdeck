import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  enqueuePendingFeedbackDelivery,
  markPendingFeedbackDelivered,
  processPendingFeedbackDeliveries,
} from '../pending-feedback.js';

describe('pending feedback recovery (PAN-585)', () => {
  let queueFile: string;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setupQueueFile(): Promise<string> {
    const dir = join(tmpdir(), `pan-585-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(dir, { recursive: true });
    return join(dir, 'pending-feedback-deliveries.json');
  }

  it('replays still-relevant blocked review feedback on startup and clears the queue', async () => {
    queueFile = await setupQueueFile();

    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-585',
      agentId: 'agent-pan-585',
      kind: 'review-blocked',
      filePath: '/tmp/workspaces/feature-pan-585/.pan/feedback/001-review-agent-changes-requested.md',
      message: 'SPECIALIST FEEDBACK: review-agent reported BLOCKED for PAN-585',
      createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });

    const deliver = vi.fn(async () => {});
    const getAgentState = vi.fn(async () => ({ id: 'agent-pan-585' } as any));
    const loadStatuses = vi.fn(() => ({
      'PAN-585': {
        issueId: 'PAN-585',
        reviewStatus: 'blocked',
        testStatus: 'pending',
        readyForMerge: false,
        updatedAt: '2026-04-27T06:00:00Z',
      },
    }));
    const getStatus = vi.fn();

    await processPendingFeedbackDeliveries({
      filePath: queueFile,
      now: Date.parse('2026-04-27T06:05:00Z'),
      _deliver: deliver,
      _getAgentState: getAgentState,
      _loadStatuses: loadStatuses as any,
      _getStatus: getStatus as any,
    });

    expect(deliver).toHaveBeenCalledWith(
      'agent-pan-585',
      'SPECIALIST FEEDBACK: review-agent reported BLOCKED for PAN-585'
    );
    await expect(readFile(queueFile, 'utf-8')).rejects.toThrow();
  });

  it('keeps queued feedback when delivery still fails on startup', async () => {
    queueFile = await setupQueueFile();

    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-585',
      agentId: 'agent-pan-585',
      kind: 'test-failed',
      filePath: '/tmp/workspaces/feature-pan-585/.pan/feedback/002-test-agent-failed.md',
      message: 'SPECIALIST FEEDBACK: test-agent reported FAILED for PAN-585',
      createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });

    await processPendingFeedbackDeliveries({
      filePath: queueFile,
      now: Date.parse('2026-04-27T06:05:00Z'),
      _deliver: vi.fn(async () => { throw new Error('tmux unavailable'); }),
      _getAgentState: vi.fn(async () => ({ id: 'agent-pan-585' } as any)),
      _loadStatuses: vi.fn(() => ({
        'PAN-585': {
          issueId: 'PAN-585',
          reviewStatus: 'passed',
          testStatus: 'failed',
          readyForMerge: false,
          updatedAt: '2026-04-27T06:00:00Z',
        },
      })) as any,
      _getStatus: vi.fn() as any,
    });

    const stored = JSON.parse(await readFile(queueFile, 'utf-8'));
    expect(stored.deliveries).toHaveLength(1);
    expect(stored.deliveries[0].kind).toBe('test-failed');
  });

  it('drops obsolete feedback once the issue status no longer needs redelivery', async () => {
    queueFile = await setupQueueFile();

    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-585',
      agentId: 'agent-pan-585',
      kind: 'review-failed',
      filePath: '/tmp/workspaces/feature-pan-585/.pan/feedback/003-review-agent-failed.md',
      message: 'SPECIALIST FEEDBACK: review-agent reported FAILED for PAN-585',
      createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });

    const deliver = vi.fn(async () => {});

    await processPendingFeedbackDeliveries({
      filePath: queueFile,
      now: Date.parse('2026-04-27T06:05:00Z'),
      _deliver: deliver,
      _getAgentState: vi.fn(async () => ({ id: 'agent-pan-585' } as any)),
      _loadStatuses: vi.fn(() => ({
        'PAN-585': {
          issueId: 'PAN-585',
          reviewStatus: 'passed',
          testStatus: 'passed',
          readyForMerge: true,
          updatedAt: '2026-04-27T06:04:00Z',
        },
      })) as any,
      _getStatus: vi.fn() as any,
    });

    expect(deliver).not.toHaveBeenCalled();
    await expect(readFile(queueFile, 'utf-8')).rejects.toThrow();
  });

  it('removes a specific queue entry after successful immediate delivery', async () => {
    queueFile = await setupQueueFile();

    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-585',
      agentId: 'agent-pan-585',
      kind: 'review-blocked',
      filePath: '/tmp/a.md',
      message: 'first',
      createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });
    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-586',
      agentId: 'agent-pan-586',
      kind: 'test-failed',
      filePath: '/tmp/b.md',
      message: 'second',
      createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });

    await markPendingFeedbackDelivered('PAN-585', 'review-blocked', { filePath: queueFile });

    const stored = JSON.parse(await readFile(queueFile, 'utf-8'));
    expect(stored.deliveries).toHaveLength(1);
    expect(stored.deliveries[0].issueId).toBe('PAN-586');
  });
});
