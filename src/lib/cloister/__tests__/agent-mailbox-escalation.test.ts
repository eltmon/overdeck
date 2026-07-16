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

  it('bounds mailbox scans when many active workspaces are retained', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const listItems = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active -= 1;
      return [];
    });
    const deps: MailboxEscalationDeps = {
      listWorkspaces: () => Array.from({ length: 40 }, (_, index) => ({
        issueId: `PAN-${3000 + index}`, workspacePath: `/workspace-${index}`,
      })),
      listItems,
      resolveTarget: vi.fn(async () => ({ needsYou: true as const, reason: 'no work agent' })),
      alreadyEscalated: () => false,
      escalate: vi.fn(async () => {}),
    };

    const patrol = patrolPendingMailboxEscalations({ policyWindowMs: 60_000, deps });
    await vi.advanceTimersByTimeAsync(0);
    expect(active).toBe(4);
    while (releases.length > 0 || listItems.mock.calls.length < 40) {
      releases.splice(0).forEach(release => release());
      await vi.advanceTimersByTimeAsync(0);
    }
    await patrol;
    expect(peak).toBe(4);
    expect(listItems).toHaveBeenCalledTimes(40);
  });
});
