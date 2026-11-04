import { describe, expect, it } from 'vitest';

import {
  edgeNotificationFromEvent,
  pendingItemsFromConversationRow,
  pendingItemsFromEnrichment,
  toNotification,
} from '../../../../src/lib/push/classify.js';

const NOW = '2026-11-01T00:00:00.000Z';
const QUESTION_TEXT = 'Should I delete the staging database before the migration runs?';

describe('push classifier (PAN-2354)', () => {
  it('turns an agent AUQ into a question keyed auq:<id> with a subject url', () => {
    const { subject, items } = pendingItemsFromEnrichment({
      agentId: 'agent-pan-1',
      issueId: 'PAN-1',
      role: 'work',
      pendingAskUserQuestion: { toolUseId: 'toolu_01', askedAt: NOW, questions: [{ question: QUESTION_TEXT }] },
    });
    expect(subject).toBe('agent:agent-pan-1');
    expect(items).toEqual([expect.objectContaining({ key: 'auq:toolu_01', kind: 'question', url: '/m?subject=agent-pan-1', label: 'PAN-1 work' })]);
  });

  it('treats a pan ask operator decision as a question', () => {
    const { items } = pendingItemsFromEnrichment({
      agentId: 'agent-pan-2',
      pendingAskUserQuestion: { toolUseId: 'operator-decision:abc', askedAt: NOW, questions: [{ question: 'Pick one' }] },
    });
    expect(items).toEqual([expect.objectContaining({ key: 'auq:operator-decision:abc', kind: 'question' })]);
  });

  it('maps an agent permission request to perm:pending', () => {
    const { items } = pendingItemsFromEnrichment({ agentId: 'agent-pan-3', pendingInputKinds: ['permissionRequest'] });
    expect(items).toEqual([expect.objectContaining({ key: 'perm:pending', kind: 'approval' })]);
  });

  it('maps an agent plan to plan:<id>', () => {
    const { items } = pendingItemsFromEnrichment({
      agentId: 'agent-pan-4',
      pendingProposedPlan: { toolUseId: 'toolu_p', askedAt: NOW, plan: '\n# Plan\nstep' },
    });
    expect(items).toEqual([expect.objectContaining({ key: 'plan:toolu_p', kind: 'approval', preview: '# Plan' })]);
  });

  it('keys a conversation permission by signature and encodes the subject', () => {
    const { subject, items } = pendingItemsFromConversationRow({ name: 'my conv', pendingPermission: { signature: 'sig', since: NOW } });
    expect(subject).toBe('conv:my conv');
    expect(items).toEqual([expect.objectContaining({ key: 'perm:sig', url: '/m?subject=my%20conv', askedAt: NOW })]);
    expect(pendingItemsFromConversationRow({ name: 'a.b', pendingPermission: { signature: null } }).items)
      .toEqual([expect.objectContaining({ key: 'perm:pending', url: '/m?subject=a.b' })]);
  });

  it('gives no items for a pane choice alone', () => {
    const row = { name: 'c', pendingPaneChoice: { kind: 'session-resume' } } as Parameters<typeof pendingItemsFromConversationRow>[0];
    expect(pendingItemsFromConversationRow(row).items).toEqual([]);
  });

  it.each([
    ['verification.started', 'finished', 'Work is done; verification started.'],
    ['merge.completed', 'finished', 'Merged.'],
    ['merge.failed', 'failed', 'Merge failed.'],
    ['review.stall-escalated', 'failed', 'A review stalled and needs you.'],
    ['conflict.repair-escalated', 'failed', 'A conflict repair needs you.'],
  ])('maps pipeline.journal %s to %s with url /m', (type, kind, body) => {
    const n = edgeNotificationFromEvent({
      type: 'pipeline.journal',
      timestamp: NOW,
      payload: { issueId: 'PAN-9', entry: { type, issueId: 'PAN-9', at: NOW } },
    });
    expect(n).toEqual(expect.objectContaining({ kind, body, url: '/m', tag: `journal:PAN-9:${type}:${NOW}`, title: expect.stringContaining('PAN-9') }));
  });

  it('ignores verification.failed and other journal types', () => {
    for (const type of ['verification.failed', 'review.verdict', 'merge.attempted']) {
      expect(edgeNotificationFromEvent({ type: 'pipeline.journal', timestamp: NOW, payload: { issueId: 'PAN-9', entry: { type, at: NOW } } })).toBeNull();
    }
  });

  it('maps agent.heartbeat_dead to failed and ignores agent.stopped', () => {
    expect(edgeNotificationFromEvent({ type: 'agent.heartbeat_dead', timestamp: NOW, payload: { agentId: 'agent-pan-5', issueId: 'PAN-5' } }))
      .toEqual(expect.objectContaining({ kind: 'failed', tag: `dead:agent-pan-5:${NOW}`, body: 'The agent stopped responding.', url: '/m' }));
    expect(edgeNotificationFromEvent({ type: 'agent.stopped', timestamp: NOW, payload: { agentId: 'agent-pan-5' } })).toBeNull();
  });

  it('never puts the conversation title in the public title', () => {
    const { items } = pendingItemsFromConversationRow({
      name: 'conv-1',
      title: 'Secret merger talks',
      pendingAskUserQuestion: { toolUseId: 'toolu_q', askedAt: NOW, questions: [{ question: QUESTION_TEXT }] },
    });
    const n = toNotification(items[0]!, { includePreview: false, now: NOW });
    expect(n.title).toBe('Question · Secret merger talks');
    expect(n.publicTitle).toBe('Question · a conversation');
    expect(n.publicTitle).not.toContain('Secret');
  });

  it('keeps question text out of the default body', () => {
    const { items } = pendingItemsFromEnrichment({
      agentId: 'agent-pan-6',
      issueId: 'PAN-6',
      pendingAskUserQuestion: { toolUseId: 'toolu_x', askedAt: NOW, questions: [{ question: QUESTION_TEXT }] },
    });
    const n = toNotification(items[0]!, { includePreview: false, now: NOW });
    expect(n.body).toBe('Tap to answer.');
    expect(JSON.stringify(n)).not.toContain('staging database');
    expect(n.publicTitle).toBe('Question · PAN-6');
  });

  it('caps the preview body at 140 characters when includePreview is on', () => {
    const { items } = pendingItemsFromEnrichment({
      agentId: 'agent-pan-7',
      pendingAskUserQuestion: { toolUseId: 'toolu_y', askedAt: NOW, questions: [{ question: 'x'.repeat(300) }] },
    });
    const n = toNotification(items[0]!, { includePreview: true, now: NOW });
    expect(n.body.length).toBeLessThanOrEqual(140);
    expect(n.body.endsWith('…')).toBe(true);
  });
});
