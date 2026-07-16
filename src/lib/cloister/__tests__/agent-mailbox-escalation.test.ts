import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailboxItem } from '../agent-mailbox.js';
import { patrolPendingMailboxEscalations, type MailboxEscalationDeps } from '../agent-mailbox-escalation.js';

describe('mailbox escalation policy window', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function pending(createdAt: string): MailboxItem {
    return {
      issueId: 'PAN-2255', role: 'work', source: 'review-agent', summary: 'Fix review',
      actionRequired: true, state: 'pending', createdAt, filePath: '/workspace/.pan/feedback/001-review.md',
      legacy: false, markdownBody: '# Review',
    };
  }

  it('waits one patrol cycle, skips escalation after resume, and escalates once without a target', async () => {
    vi.setSystemTime(new Date('2026-07-16T12:00:00Z'));
    const escalate = vi.fn(async () => {});
    let target: { agentId: string } | { needsYou: true; reason: string } = { needsYou: true, reason: 'no work agent' };
    let escalated = false;
    const deps: MailboxEscalationDeps = {
      listWorkspaces: () => [{ issueId: 'PAN-2255', workspacePath: '/workspace' }],
      listItems: async () => [pending('2026-07-16T12:00:00Z')],
      resolveTarget: vi.fn(async () => target),
      alreadyEscalated: () => escalated,
      escalate: async (...args) => { escalated = true; await escalate(...args); },
    };

    await patrolPendingMailboxEscalations({ policyWindowMs: 60_000, deps });
    expect(escalate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    target = { agentId: 'agent-pan-2255' };
    await patrolPendingMailboxEscalations({ policyWindowMs: 60_000, deps });
    expect(escalate).not.toHaveBeenCalled();
    target = { needsYou: true, reason: 'no work agent' };
    await patrolPendingMailboxEscalations({ policyWindowMs: 60_000, deps });
    await patrolPendingMailboxEscalations({ policyWindowMs: 60_000, deps });
    expect(escalate).toHaveBeenCalledTimes(1);
    expect(escalate).toHaveBeenCalledWith('PAN-2255', 'no work agent', expect.objectContaining({
      role: 'work', source: 'review-agent', feedbackPath: '/workspace/.pan/feedback/001-review.md',
    }));
  });
});
