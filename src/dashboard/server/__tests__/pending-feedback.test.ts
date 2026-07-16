import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  enqueuePendingFeedbackDelivery,
  markPendingFeedbackDelivered,
  markPendingFeedbackTransportDelivered,
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
      role: 'work',
      kind: 'review-blocked',
      filePath: '/tmp/workspaces/feature-pan-585/.pan/feedback/001-review-agent-changes-requested.md',
      message: 'SPECIALIST FEEDBACK: review-agent reported BLOCKED for PAN-585',
      createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });

    const durable = JSON.parse(await readFile(queueFile, 'utf-8'));
    expect(durable.deliveries[0]).toMatchObject({ issueId: 'PAN-585', role: 'work' });
    expect(durable.deliveries[0]).not.toHaveProperty('agentId');

    const deliver = vi.fn(async () => {});
    const resolveTarget = vi.fn(async () => ({ agentId: 'agent-pan-585' }));
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
      _resolveTarget: resolveTarget,
      _markMailboxDelivered: vi.fn(async () => {}),
      _loadStatuses: loadStatuses as any,
      _getStatus: getStatus as any,
    });

    expect(deliver).toHaveBeenCalledWith(
      'agent-pan-585',
      'SPECIALIST FEEDBACK: review-agent reported BLOCKED for PAN-585'
    );
    await expect(readFile(queueFile, 'utf-8')).rejects.toThrow();
  });

  it('serializes concurrent journal updates without losing unrelated deliveries', async () => {
    queueFile = await setupQueueFile();
    const delivery = (issueId: string): Parameters<typeof enqueuePendingFeedbackDelivery>[0] => ({
      issueId, role: 'work', kind: 'review-blocked', filePath: `/tmp/${issueId}.md`,
      message: `${issueId} feedback`, createdAt: '2026-04-27T06:00:00Z',
    });

    await Promise.all([
      enqueuePendingFeedbackDelivery(delivery('PAN-585'), { filePath: queueFile }),
      enqueuePendingFeedbackDelivery(delivery('PAN-586'), { filePath: queueFile }),
    ]);

    const stored = JSON.parse(await readFile(queueFile, 'utf8'));
    expect(stored.deliveries.map((item: { issueId: string }) => item.issueId).sort()).toEqual(['PAN-585', 'PAN-586']);
  });

  it('keeps queued feedback when delivery still fails on startup', async () => {
    queueFile = await setupQueueFile();

    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-585',
      role: 'work',
      kind: 'test-failed',
      filePath: '/tmp/workspaces/feature-pan-585/.pan/feedback/002-test-agent-failed.md',
      message: 'SPECIALIST FEEDBACK: test-agent reported FAILED for PAN-585',
      createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });

    await processPendingFeedbackDeliveries({
      filePath: queueFile,
      now: Date.parse('2026-04-27T06:05:00Z'),
      _deliver: vi.fn(async () => { throw new Error('tmux unavailable'); }),
      _resolveTarget: vi.fn(async () => ({ agentId: 'agent-pan-585' })),
      _markMailboxDelivered: vi.fn(async () => {}),
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

  it('retries only the mailbox transition after transport succeeds', async () => {
    queueFile = await setupQueueFile();
    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-585', role: 'work', kind: 'review-blocked', filePath: '/tmp/review.md',
      message: 'review feedback', createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });
    const deliver = vi.fn(async () => {});
    const markMailboxDelivered = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce(undefined);
    const options = {
      filePath: queueFile,
      now: Date.parse('2026-04-27T06:05:00Z'),
      _deliver: deliver,
      _resolveTarget: vi.fn(async () => ({ agentId: 'agent-pan-585' })),
      _markMailboxDelivered: markMailboxDelivered,
      _loadStatuses: vi.fn(() => ({ 'PAN-585': { issueId: 'PAN-585', reviewStatus: 'blocked' } })) as any,
      _getStatus: vi.fn() as any,
    };

    await processPendingFeedbackDeliveries(options);
    const retained = JSON.parse(await readFile(queueFile, 'utf8'));
    expect(retained.deliveries[0].transportDeliveredAt).toBeDefined();
    await processPendingFeedbackDeliveries(options);

    expect(deliver).toHaveBeenCalledOnce();
    expect(markMailboxDelivered).toHaveBeenCalledTimes(2);
    await expect(readFile(queueFile, 'utf8')).rejects.toThrow();
  });

  it('drops obsolete feedback once the issue status no longer needs redelivery', async () => {
    queueFile = await setupQueueFile();

    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-585',
      role: 'work',
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
      _resolveTarget: vi.fn(async () => ({ agentId: 'agent-pan-585' })),
      _markMailboxDelivered: vi.fn(async () => {}),
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
      role: 'work',
      kind: 'review-blocked',
      filePath: '/tmp/a.md',
      message: 'first',
      createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });
    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-586',
      role: 'work',
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

  it('records immediate transport success before mailbox persistence completes', async () => {
    queueFile = await setupQueueFile();
    await enqueuePendingFeedbackDelivery({
      issueId: 'PAN-585', role: 'work', kind: 'review-blocked', filePath: '/tmp/a.md',
      message: 'first', createdAt: '2026-04-27T06:00:00Z',
    }, { filePath: queueFile });

    await markPendingFeedbackTransportDelivered('PAN-585', 'review-blocked', {
      filePath: queueFile, at: '2026-04-27T06:01:00Z',
    });

    const stored = JSON.parse(await readFile(queueFile, 'utf8'));
    expect(stored.deliveries[0].transportDeliveredAt).toBe('2026-04-27T06:01:00Z');
  });

  it('normalizes legacy queue entries without a role before replay', async () => {
    queueFile = await setupQueueFile();
    await writeFile(queueFile, JSON.stringify({ deliveries: [{
      issueId: 'PAN-585', kind: 'review-blocked', filePath: '/tmp/legacy.md',
      message: 'legacy feedback', createdAt: '2026-04-27T06:00:00Z',
    }] }));
    const markMailboxDelivered = vi.fn(async delivery => {
      expect(delivery.role).toBe('work');
    });

    await processPendingFeedbackDeliveries({
      filePath: queueFile,
      now: Date.parse('2026-04-27T06:05:00Z'),
      _deliver: vi.fn(async () => {}),
      _resolveTarget: vi.fn(async () => ({ agentId: 'agent-pan-585' })),
      _markMailboxDelivered: markMailboxDelivered,
      _loadStatuses: vi.fn(() => ({
        'PAN-585': { issueId: 'PAN-585', reviewStatus: 'blocked' },
      })) as any,
      _getStatus: vi.fn() as any,
    });

    expect(markMailboxDelivered).toHaveBeenCalledOnce();
    await expect(readFile(queueFile, 'utf-8')).rejects.toThrow();
  });
});
