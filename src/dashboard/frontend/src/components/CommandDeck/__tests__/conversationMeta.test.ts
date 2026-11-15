import { describe, expect, it } from 'vitest';
import { conversationMetaParts } from '../conversationMeta';
import { shortModel } from '../modelLabels';
import type { Conversation } from '../ConversationList';

const now = new Date('2026-11-15T12:00:00.000Z');
const base: Conversation = {
  id: 1,
  name: 'c',
  tmuxSession: 'conv-c',
  status: 'ended',
  cwd: '/tmp',
  issueId: null,
  createdAt: '2026-11-15T09:00:00.000Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: false,
};
const texts = (overrides: Partial<Conversation>) => conversationMetaParts({ ...base, ...overrides }, now).parts.map((p) => p.text);

describe('conversationMetaParts (PAN-5293 F-D15)', () => {
  it('leads with the state word', () => {
    expect(texts({ pendingInputCount: 1, isWorking: true })[0]).toBe('Needs you');
    expect(texts({ isWorking: true })[0]).toBe('Working');
    expect(texts({ sessionAlive: true, lastActivityAt: '2026-11-15T11:55:00.000Z' })[0]).toMatch(/^Idle 5m/);
    expect(texts({})[0]).toMatch(/^3h/);
    expect(texts({ lastAttachedAt: '2026-11-15T11:00:00.000Z' })[0]).toMatch(/^1h/);
  });

  it('describes the changes in words', () => {
    const none = conversationMetaParts({ ...base, changeTotals: { files: 0, additions: 0, deletions: 0, uncommittedFiles: 0, commitsLocal: 0 } }, now);
    expect(none.parts.map((p) => p.text)).toContain('no file changes');

    const some = conversationMetaParts({ ...base, changeTotals: { files: 2, additions: 86, deletions: 1, uncommittedFiles: 1, commitsLocal: 0 } }, now);
    expect(some.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '+86', tone: 'additions' }),
      expect.objectContaining({ text: '−1', tone: 'deletions' }),
      expect.objectContaining({ text: '1 not committed', tone: 'muted' }),
    ]));
    expect(texts({})).not.toContain('no file changes');
  });

  it('names a non-default harness and shows the cost', () => {
    expect(texts({ harness: 'codex', totalCost: 1.234 })).toEqual(expect.arrayContaining(['Codex', '$1.23']));
    expect(texts({ harness: 'claude-code' })).not.toContain('Claude Code');
    expect(texts({ totalCost: 0.004 })).toContain('<$0.01');
  });

  it('puts branch, model, tokens and harness in the title', () => {
    const { title } = conversationMetaParts({ ...base, branch: 'main', model: 'claude-opus-4-8', totalTokens: 2_500_000, harness: 'codex' }, now);
    expect(title).toBe('Branch main · Model opus-4-8 · 2.5M tokens · Harness Codex');
  });

  it('shortModel trims the vendor prefix and date suffix', () => {
    expect(shortModel('claude-sonnet-4-6-20260101')).toBe('sonnet-4-6');
  });
});
